import sharp from "sharp";
import { IMAGE_SOURCE_MAX_PIXELS } from "@workspace/api-zod/image-policy";

const VALIDATION_CACHE_TTL_MS = 5 * 60_000;
const VALIDATION_CACHE_MAX_ENTRIES = 512;
type ValidationResult = {
  metadataMs: number;
  pixelValidationMs: number;
  pixelValidated: boolean;
};
const validationCache = new Map<string, { expiresAt: number; result: ValidationResult }>();

function cachedValidation(key: string): ValidationResult | null {
  const entry = validationCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= performance.now()) {
    validationCache.delete(key);
    return null;
  }
  // Refresh insertion order so frequently printed reports remain warm.
  validationCache.delete(key);
  validationCache.set(key, entry);
  return { ...entry.result, metadataMs: 0, pixelValidationMs: 0 };
}

function rememberValidation(key: string, result: ValidationResult) {
  validationCache.delete(key);
  validationCache.set(key, { expiresAt: performance.now() + VALIDATION_CACHE_TTL_MS, result });
  while (validationCache.size > VALIDATION_CACHE_MAX_ENTRIES) {
    const oldest = validationCache.keys().next().value;
    if (oldest === undefined) break;
    validationCache.delete(oldest);
  }
}

/**
 * Managed variants were decoded, normalized, and checksum-verified before they
 * became ready. Re-read only their lightweight headers here. Legacy files
 * still get a full pixel validation before PDF headers are sent. Successful
 * validation is cached only for the exact file fingerprint supplied by the
 * caller, so changed/replaced files are validated again.
 */
export async function validateReportPdfImage(
  filePath: string,
  managed: boolean,
  imageReader: typeof sharp = sharp,
  fileFingerprint?: string,
) {
  const cacheKey = fileFingerprint ? `${filePath}\0${managed ? "managed" : "legacy"}\0${fileFingerprint}` : null;
  const cached = cacheKey ? cachedValidation(cacheKey) : null;
  if (cached) return cached;

  const metadataStarted = performance.now();
  const metadata = await imageReader(filePath, { limitInputPixels: IMAGE_SOURCE_MAX_PIXELS }).metadata();
  const metadataMs = performance.now() - metadataStarted;
  if (!metadata.width || !metadata.height
    || metadata.width * metadata.height > IMAGE_SOURCE_MAX_PIXELS
    || !["jpeg", "png"].includes(metadata.format ?? "")) {
    throw new Error("invalid_pdf_image_metadata");
  }

  let pixelValidationMs = 0;
  if (!managed) {
    const validationStarted = performance.now();
    await imageReader(filePath, {
      limitInputPixels: IMAGE_SOURCE_MAX_PIXELS,
      sequentialRead: true,
    }).stats();
    pixelValidationMs = performance.now() - validationStarted;
  }

  const result = { metadataMs, pixelValidationMs, pixelValidated: !managed };
  if (cacheKey) rememberValidation(cacheKey, result);
  return result;
}
