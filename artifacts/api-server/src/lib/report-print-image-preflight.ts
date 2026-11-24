export const REPORT_PRINT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REPORT_PRINT_IMAGES_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const REPORT_PRINT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type ReportPrintImageMetadata = {
  filename: string;
  size: number;
  contentType: string | null;
};

export function assertReportPrintImageBudget(images: readonly ReportPrintImageMetadata[]): number {
  let totalBytes = 0;
  for (const image of images) {
    if (!Number.isSafeInteger(image.size) || image.size <= 0
      || image.size > REPORT_PRINT_IMAGE_MAX_BYTES
      || !REPORT_PRINT_IMAGE_MIME_TYPES.includes(image.contentType as typeof REPORT_PRINT_IMAGE_MIME_TYPES[number])) {
      throw new Error("report_print_image_unavailable");
    }
    totalBytes += image.size;
    if (totalBytes > REPORT_PRINT_IMAGES_MAX_TOTAL_BYTES) {
      throw new Error("report_print_images_total_limit");
    }
  }
  return totalBytes;
}

export function reportPrintMimeTypeFromFilename(filename: string): string | null {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}
