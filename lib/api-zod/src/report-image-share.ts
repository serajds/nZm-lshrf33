export const REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES = 20;
export const REPORT_IMAGE_SHARE_MAX_LIMIT = 1000;
export const REPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function isJpgReportImageUpload(fileName: string, mimeType: string): boolean {
  return mimeType === "image/jpeg" && /\.jpg$/i.test(fileName);
}

export function nextReportImageShareUploadCount(
  uploadedCount: number,
  maxImages = REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES,
): number | null {
  if (!Number.isSafeInteger(maxImages) || maxImages < 1 || maxImages > REPORT_IMAGE_SHARE_MAX_LIMIT
    || !Number.isSafeInteger(uploadedCount) || uploadedCount < 0 || uploadedCount >= maxImages) {
    return null;
  }
  return uploadedCount + 1;
}
