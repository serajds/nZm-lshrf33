import sharp from "sharp";
import path from "node:path";
import type { SystemImageAssetKind } from "@workspace/db";

export const MAX_SOURCE_BYTES = 18 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 16_000_000;

const profiles: Record<SystemImageAssetKind, { maxEdge: number; quality: number; skipBytes: number }> = {
  project_file: { maxEdge: 1600, quality: 78, skipBytes: 240 * 1024 },
  report_photo: { maxEdge: 1600, quality: 78, skipBytes: 240 * 1024 },
  attendance_selfie: { maxEdge: 800, quality: 78, skipBytes: 160 * 1024 },
  company_logo: { maxEdge: 1000, quality: 82, skipBytes: 240 * 1024 },
  unreferenced_upload: { maxEdge: 1600, quality: 78, skipBytes: 240 * 1024 },
};

export type ImageBufferCompressionOutcome =
  | { status: "compressed"; outputBytes: number; buffer: Buffer; contentType: string }
  | { status: "skipped"; outputBytes: number; reason: string };

export class ImageCompressionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ImageCompressionError";
  }
}

function contentTypeFor(format: string, filename: string, convertedHeif: boolean): string {
  if (convertedHeif) return "image/jpeg";
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "tiff": return "image/tiff";
    case "heif":
      return path.extname(filename).toLowerCase() === ".avif" ? "image/avif" : "image/heif";
    default: throw new ImageCompressionError("unsupported_format");
  }
}

function maxEdgeFor(kinds: SystemImageAssetKind[]): number {
  return Math.min(...kinds.map(kind => profiles[kind].maxEdge));
}

function qualityFor(kinds: SystemImageAssetKind[]): number {
  return Math.min(...kinds.map(kind => profiles[kind].quality));
}

function skipBytesFor(kinds: SystemImageAssetKind[]): number {
  return Math.min(...kinds.map(kind => profiles[kind].skipBytes));
}

export async function compressImageBuffer(
  original: Buffer,
  inputKinds: SystemImageAssetKind[],
  filename = "",
): Promise<ImageBufferCompressionOutcome> {
  if (original.length > MAX_SOURCE_BYTES) throw new ImageCompressionError("source_too_large");
  const kinds: SystemImageAssetKind[] = inputKinds.length ? inputKinds : ["project_file"];
  let source: sharp.Metadata;
  try {
    source = await sharp(original, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new ImageCompressionError("pixel_limit");
    }
    throw new ImageCompressionError("unreadable_image");
  }

  if (!source.width || !source.height) throw new ImageCompressionError("invalid_dimensions");
  if (source.width * source.height > MAX_SOURCE_PIXELS) {
    throw new ImageCompressionError("pixel_limit");
  }
  if (source.pages && source.pages > 1) {
    return { status: "skipped", outputBytes: original.length, reason: "animated_image" };
  }
  const extension = path.extname(filename).toLowerCase();
  const isLegacyHeif = source.format === "heif" && (extension === ".heic" || extension === ".heif");
  const isAvifSource = source.format === "heif" && extension === ".avif";
  if (!source.format || !["jpeg", "png", "webp", "tiff"].includes(source.format) && !isAvifSource && !isLegacyHeif) {
    return { status: "skipped", outputBytes: original.length, reason: "unsupported_format" };
  }

  const maxEdge = maxEdgeFor(kinds);
  const needsResize = Math.max(source.width, source.height) > maxEdge;
  if (!needsResize && original.length <= skipBytesFor(kinds)) {
    return { status: "skipped", outputBytes: original.length, reason: "already_compact" };
  }

  const quality = qualityFor(kinds);
  let pipeline = sharp(original, { limitInputPixels: MAX_SOURCE_PIXELS })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  if (source.format === "jpeg") pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  else if (source.format === "webp") pipeline = pipeline.webp({ quality, effort: 3 });
  else if (source.format === "png") pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  else if (source.format === "tiff") pipeline = pipeline.tiff({ quality, compression: "jpeg" });
  else if (isAvifSource) pipeline = pipeline.avif({ quality, effort: 3 });
  else if (isLegacyHeif) pipeline = pipeline.jpeg({ quality, mozjpeg: true });

  let output: Buffer;
  try {
    output = await pipeline.toBuffer();
  } catch {
    throw new ImageCompressionError("conversion_failed");
  }
  const verified = await sharp(output, { limitInputPixels: MAX_SOURCE_PIXELS }).metadata().catch(() => null);
  const expectedFormat = isLegacyHeif ? "jpeg" : source.format;
  if (!verified?.width || !verified.height || verified.format !== expectedFormat) {
    throw new ImageCompressionError("verification_failed");
  }

  const dimensionReduction = Math.max(source.width, source.height) > Math.max(verified.width, verified.height);
  if (output.length >= original.length) {
    return {
      status: "skipped",
      outputBytes: original.length,
      reason: dimensionReduction ? "no_size_saving" : "already_compact",
    };
  }

  return {
    status: "compressed",
    outputBytes: output.length,
    buffer: output,
    contentType: contentTypeFor(source.format, filename, isLegacyHeif),
  };
}
