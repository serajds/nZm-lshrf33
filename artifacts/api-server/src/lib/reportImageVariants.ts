import sharp from "sharp";
import { IMAGE_POLICY_VERSION, IMAGE_PROFILES, REPORT_IMAGE_MAX_PIXELS } from "@workspace/api-zod";

export type ReportImageVariant = "report-photo" | "report-thumbnail" | "report-logo";
type ImageResult = { buffer: Buffer; contentType: string };
export type ReportImageVariantDiagnostic = {
  state: "memory_hit" | "coalesced" | "processed";
  sourceBytes?: number;
  width?: number;
  height?: number;
  metadataMs?: number;
  encodeMs?: number;
  outputBytes?: number;
  activeJobs: number;
  queuedJobs: number;
};

export function shouldServeOriginalCompressedSharePhoto(
  environment: string | undefined,
  filename: string,
  variant: ReportImageVariant,
  storedVariantFound: boolean,
): boolean {
  const isCompressedSharePhoto =
    /^report-share-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-compressed\.jpg$/i
      .test(filename);
  if (variant !== "report-photo" || !isCompressedSharePhoto) return false;
  return environment === "development" || !storedVariantFound;
}

type VariantProcessor = ((
  key: string,
  variant: ReportImageVariant,
  readSource: () => Promise<Buffer>,
  onDiagnostic?: (diagnostic: ReportImageVariantDiagnostic) => void,
) => Promise<ImageResult>) & {
  getStatus: () => { activeJobs: number; queuedJobs: number; cachedEntries: number; cacheBytes: number; pendingJobs: number };
};
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const TTL = 10 * 60 * 1000;
export const REPORT_PRINT_IMAGE_MAX_BYTES = IMAGE_PROFILES.report_technical.maxOutputBytes;
export const REPORT_PRINT_IMAGE_MAX_EDGE = IMAGE_PROFILES.report.maxEdge;

async function encodePrintImage(source: Buffer, options: { limitInputPixels: number }): Promise<ImageResult> {
  const qualities = [90, 86, 82];
  let smallest: Buffer | null = null;

  for (const quality of qualities) {
    const output = await sharp(source, options)
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: REPORT_PRINT_IMAGE_MAX_EDGE, height: REPORT_PRINT_IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();
    if (!smallest || output.length < smallest.length) smallest = output;
    if (output.length <= REPORT_PRINT_IMAGE_MAX_BYTES) {
      return { buffer: output, contentType: "image/jpeg" };
    }
  }

  if (!smallest || smallest.length > REPORT_PRINT_IMAGE_MAX_BYTES) {
    throw new Error("Report image exceeds the 1.5 MB quality-preserving limit");
  }
  return { buffer: smallest, contentType: "image/jpeg" };
}

/** Server-only derived bytes; callers MUST authorize before even consulting it. */
export function createReportImageVariants() {
  const cache = new Map<string, ImageResult & { expires: number }>();
  const pending = new Map<string, Promise<ImageResult>>();
  let bytes = 0;
  let active = 0;
  const queue: Array<() => void> = [];
  const evict = (key: string) => {
    const entry = cache.get(key);
    if (entry) bytes -= entry.buffer.length;
    cache.delete(key);
  };
  const getVariant: VariantProcessor = async (key, variant, readSource, onDiagnostic) => {
    const cacheKey = `${key}:${variant}:v${IMAGE_POLICY_VERSION}`;
    const now = Date.now();
    for (const [k, value] of cache) if (value.expires <= now) evict(k);
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey);
      cache.set(cacheKey, hit);
      onDiagnostic?.({
        state: "memory_hit",
        outputBytes: hit.buffer.length,
        activeJobs: active,
        queuedJobs: queue.length,
      });
      return hit;
    }
    const existing = pending.get(cacheKey);
    if (existing) {
      onDiagnostic?.({ state: "coalesced", activeJobs: active, queuedJobs: queue.length });
      return existing;
    }
    if (active >= 2 && queue.length >= 16) throw new Error("Report image processor is busy");
    const task = (async () => {
      if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
      else active++;
      try {
        const source = await readSource();
        if (source.length > MAX_SOURCE_BYTES) throw new Error("Report image is too large");
        const options = { limitInputPixels: REPORT_IMAGE_MAX_PIXELS };
        const metadataStarted = onDiagnostic ? performance.now() : 0;
        const metadata = await sharp(source, options).metadata();
        const metadataMs = onDiagnostic ? performance.now() - metadataStarted : undefined;
        const edge = variant === "report-logo" ? IMAGE_PROFILES.logo.maxEdge
          : variant === "report-thumbnail" ? IMAGE_PROFILES.thumbnail.maxEdge : REPORT_PRINT_IMAGE_MAX_EDGE;
        if (variant === "report-photo") {
          const canReuseJpeg = source.length <= REPORT_PRINT_IMAGE_MAX_BYTES
            && metadata.format === "jpeg"
            && (metadata.width ?? Infinity) <= REPORT_PRINT_IMAGE_MAX_EDGE
            && (metadata.height ?? Infinity) <= REPORT_PRINT_IMAGE_MAX_EDGE
            && !metadata.orientation && !metadata.exif && !metadata.icc && !metadata.xmp && !metadata.iptc;
          const encodeStarted = onDiagnostic ? performance.now() : 0;
          const result = canReuseJpeg
            ? { buffer: source, contentType: "image/jpeg" }
            : await encodePrintImage(source, options);
          const encodeMs = onDiagnostic ? performance.now() - encodeStarted : undefined;
          if (onDiagnostic) onDiagnostic({
            state: "processed",
            sourceBytes: source.length,
            width: metadata.width,
            height: metadata.height,
            metadataMs,
            encodeMs,
            outputBytes: result.buffer.length,
            activeJobs: active,
            queuedJobs: queue.length,
          });
          const expires = Date.now() + TTL;
          while (bytes + result.buffer.length > MAX_CACHE_BYTES && cache.size) evict(cache.keys().next().value!);
          if (result.buffer.length <= MAX_CACHE_BYTES) {
            cache.set(cacheKey, { ...result, expires });
            bytes += result.buffer.length;
          }
          return result;
        }
        const png = variant === "report-logo" || metadata.hasAlpha;
        let pipeline = sharp(source, options).rotate().resize({
          width: edge, height: edge, fit: "inside", withoutEnlargement: true,
        });
        pipeline = png
          ? pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
          : pipeline.jpeg({ quality: variant === "report-thumbnail" ? 68 : 82, mozjpeg: true });
        const encodeStarted = onDiagnostic ? performance.now() : 0;
        let buffer = await pipeline.toBuffer();
        const encodeMs = onDiagnostic ? performance.now() - encodeStarted : undefined;
        let contentType = png ? "image/png" : "image/jpeg";
        // Do not inflate an already-small supported image or lose alpha/orientation.
        const originalTypes: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
        const originalType = originalTypes[metadata.format ?? ""];
        if (originalType && !metadata.orientation && (metadata.width ?? Infinity) <= edge
          && (metadata.height ?? Infinity) <= edge && source.length < buffer.length) {
          buffer = source;
          contentType = originalType;
        }
        const result = { buffer, contentType };
        while (bytes + buffer.length > MAX_CACHE_BYTES && cache.size) evict(cache.keys().next().value!);
        if (buffer.length <= MAX_CACHE_BYTES) {
          cache.set(cacheKey, { ...result, expires: Date.now() + TTL });
          bytes += buffer.length;
        }
        if (onDiagnostic) onDiagnostic({
          state: "processed",
          sourceBytes: source.length,
          width: metadata.width,
          height: metadata.height,
          metadataMs,
          encodeMs,
          outputBytes: buffer.length,
          activeJobs: active,
          queuedJobs: queue.length,
        });
        return result;
      } finally {
        const next = queue.shift();
        if (next) next();
        else active--;
      }
    })();
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  };
  getVariant.getStatus = () => ({
    activeJobs: active,
    queuedJobs: queue.length,
    cachedEntries: cache.size,
    cacheBytes: bytes,
    pendingJobs: pending.size,
  });
  return getVariant;
}

export const reportImageVariant = createReportImageVariants();
