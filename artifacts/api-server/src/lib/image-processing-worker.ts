import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import {
  IMAGE_POLICY_VERSION, IMAGE_PROFILES, IMAGE_SOURCE_MAX_BYTES, IMAGE_SOURCE_MAX_PIXELS,
  isImageProfile, hasSupportedImageSignature, isSvgImageSignature,
  type ImageProcessingException,
} from "@workspace/api-zod/image-policy";
import { sanitizeSvgForRasterization } from "./sanitize-svg.js";

// A one-job child process, not a worker thread in the API's memory space.
// Only the parent supplies paths. No URLs, remote fetches, DB or storage access.
sharp.cache(false);
sharp.concurrency(1);
process.on("disconnect", () => process.exit(1));
process.send?.({ kind: "ready" });
process.once("message", async (message: { sourcePath: string; outputDir: string; profile: unknown; format?: string; prepared?: boolean }) => {
  const began = performance.now();
  try {
    if (!isImageProfile(message.profile)) throw new Error("invalid_profile");
    const policy = IMAGE_PROFILES[message.profile];
    const stat = await fs.stat(message.sourcePath);
    if (!stat.isFile() || stat.size < 1 || stat.size > IMAGE_SOURCE_MAX_BYTES) throw new Error("source_size_limit");
    const source = await fs.readFile(message.sourcePath);
    if (!hasSupportedImageSignature(source)) throw new Error("unsupported_format");
    const isSvg = isSvgImageSignature(source);
    const normalizedSource = isSvg ? sanitizeSvgForRasterization(source) : source;
    const options = { limitInputPixels: IMAGE_SOURCE_MAX_PIXELS, failOn: "warning" as const };
    const meta = await sharp(normalizedSource, options).metadata();
    const metadataMs = performance.now() - began;
    if (!meta.width || !meta.height || meta.width > Math.floor(IMAGE_SOURCE_MAX_PIXELS / meta.height)) throw new Error("pixel_limit");
    if (message.prepared && (Math.max(meta.width, meta.height) > policy.maxEdge || source.length > policy.maxOutputBytes)) {
      throw new Error("invalid_prepared_image");
    }
    if ((meta.pages ?? 1) !== 1) throw new Error("animated_image");
    if (!["jpeg", "png", "webp", "tiff", "heif", "avif", "gif", "svg"].includes(meta.format ?? "")) throw new Error("unsupported_format");
    const alpha = policy.preserveAlpha && meta.hasAlpha;
    if (message.format && message.format !== policy.format
      && (!("fallbackFormat" in policy) || message.format !== policy.fallbackFormat)) throw new Error("invalid_profile");
    const format = alpha ? "png" : message.format ?? policy.format;
    const mimeType = `image/${format}`;
    const canReuse = !isSvg && meta.format === format && ["srgb", "b-w"].includes(meta.space ?? "")
      && !meta.exif && !meta.icc && !meta.xmp && !meta.iptc && !meta.orientation
      && Math.max(meta.width, meta.height) <= policy.maxEdge
      && source.length <= (message.prepared ? policy.maxOutputBytes : policy.targetMaxBytes);
    let buffer: Buffer = source;
    let encodes = 0;
    const encodeAt = performance.now();
    if (!canReuse) {
      for (const quality of policy.qualities) {
        let pipeline = sharp(normalizedSource, options).rotate().resize({
          width: policy.maxEdge, height: policy.maxEdge, fit: "inside", withoutEnlargement: true,
        });
        if (!policy.preserveAlpha) pipeline = pipeline.flatten({ background: "#ffffff" });
        buffer = await (format === "png" ? pipeline.png({ compressionLevel: 8 })
          : format === "jpeg" ? pipeline.jpeg({ quality, mozjpeg: true })
            : pipeline.webp({ quality, effort: 4 })).toBuffer();
        encodes++;
        if (buffer.length <= policy.targetMaxBytes || format === "png") break;
      }
    }
    if (buffer.length > policy.maxOutputBytes) throw new Error("quality_preserving_output_too_large");
    const outputMetadata = await sharp(buffer, options).metadata();
    if (!outputMetadata.width || !outputMetadata.height
      || Math.max(outputMetadata.width, outputMetadata.height) > policy.maxEdge
      || outputMetadata.exif || outputMetadata.icc || outputMetadata.xmp || outputMetadata.iptc) throw new Error("output_verification_failed");
    const exception: ImageProcessingException | null = buffer.length > policy.targetMaxBytes
      ? canReuse && message.prepared ? "prepared_input_above_target" : "quality_floor_exceeds_target"
      : buffer.length < policy.targetMinBytes ? "small_output_below_target" : null;
    const filename = `image.${format === "jpeg" ? "jpg" : format}`;
    await fs.writeFile(path.join(message.outputDir, filename), buffer, { flag: "wx" });
    process.send?.({
      ok: true, filename, policyVersion: IMAGE_POLICY_VERSION, profile: message.profile,
      mimeType, byteSize: buffer.length, width: outputMetadata.width, height: outputMetadata.height,
      exception, reused: canReuse, inputBytes: source.length, encodes,
      metadataMs, encodeMs: performance.now() - encodeAt, elapsedMs: performance.now() - began,
    }, () => process.exit(0));
  } catch (error) {
    const known = new Set([
      "invalid_profile", "invalid_prepared_image", "source_size_limit", "pixel_limit", "animated_image", "unsupported_format",
      "invalid_svg",
      "quality_preserving_output_too_large", "output_verification_failed",
    ]);
    // Native errors may embed paths or metadata; only stable error codes cross IPC.
    const code = error instanceof Error && /pixel limit|exceeds.*limit.*pixels/i.test(error.message) ? "pixel_limit"
      : error instanceof Error && known.has(error.message) ? error.message : "invalid_or_unsupported_image";
    process.send?.({ ok: false, code }, () => process.exit(1));
  }
});
