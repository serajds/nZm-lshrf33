import sharp from "sharp";
import { IMAGE_SOURCE_MAX_PIXELS } from "@workspace/api-zod/image-policy";

/**
 * Managed variants were decoded, normalized, and checksum-verified before they
 * became ready. Re-read only their lightweight headers here. Legacy files
 * still get a full pixel validation before PDF headers are sent.
 */
export async function validateReportPdfImage(
  filePath: string,
  managed: boolean,
  imageReader: typeof sharp = sharp,
) {
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

  return { metadataMs, pixelValidationMs, pixelValidated: !managed };
}
