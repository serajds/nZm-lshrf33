import sharp from "sharp";

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
    const cacheKey = `${key}:${variant}:v1`;
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
        const options = { limitInputPixels: 40_000_000 };
        const metadataStarted = onDiagnostic ? performance.now() : 0;
        const metadata = await sharp(source, options).metadata();
        const metadataMs = onDiagnostic ? performance.now() - metadataStarted : undefined;
        const edge = variant === "report-logo" ? 1000 : variant === "report-thumbnail" ? 640 : 1600;
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
