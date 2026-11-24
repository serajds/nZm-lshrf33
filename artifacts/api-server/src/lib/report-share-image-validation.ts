import sharp from "sharp";
import {
  REPORT_IMAGE_MAX_BYTES,
  REPORT_IMAGE_MAX_PIXELS,
  isAllowedReportImageDimensions,
  isJpgReportImageUpload,
} from "@workspace/api-zod";

export class ReportShareImageValidationError extends Error {
  constructor(message: string, readonly statusCode: 400 | 413) {
    super(message);
    this.name = "ReportShareImageValidationError";
  }
}

export async function validateReportShareImageBuffer(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): Promise<{ width: number; height: number }> {
  if (!isJpgReportImageUpload(originalName, mimeType)) {
    throw new ReportShareImageValidationError("يُسمح فقط برفع الصور بامتداد JPG", 400);
  }
  if (buffer.length === 0) {
    throw new ReportShareImageValidationError("محتوى الملف ليس صورة JPG صالحة", 400);
  }
  if (buffer.length > REPORT_IMAGE_MAX_BYTES) {
    throw new ReportShareImageValidationError("الحد الأقصى لحجم الصورة 5 ميغابايت", 413);
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: REPORT_IMAGE_MAX_PIXELS }).metadata();
  } catch (error) {
    if (error instanceof Error && /pixel limit|exceeds.*limit/i.test(error.message)) {
      throw new ReportShareImageValidationError("أبعاد الصورة تتجاوز الحد الآمن وهو 40 ميغابكسل", 413);
    }
    throw new ReportShareImageValidationError("محتوى الملف ليس صورة JPG صالحة", 400);
  }

  if (metadata.format !== "jpeg") {
    throw new ReportShareImageValidationError("محتوى الملف ليس صورة JPG صالحة", 400);
  }
  if (!isAllowedReportImageDimensions(metadata.width, metadata.height)) {
    throw new ReportShareImageValidationError("أبعاد الصورة تتجاوز الحد الآمن وهو 40 ميغابكسل", 413);
  }
  return { width: metadata.width!, height: metadata.height! };
}
