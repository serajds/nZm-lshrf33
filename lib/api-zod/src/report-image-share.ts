export const REPORT_IMAGE_SHARE_DEFAULT_MAX_IMAGES = 20;
export const REPORT_IMAGE_SHARE_MAX_LIMIT = 1000;
export const REPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REPORT_IMAGE_MAX_PIXELS = 40_000_000;

export type ReportShareImageGroup = {
  id?: string;
  category: string;
  urls: string[];
  [key: string]: unknown;
};

export function isAllowedReportImageDimensions(width: unknown, height: unknown): boolean {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return false;
  const safeWidth = width as number;
  const safeHeight = height as number;
  return safeWidth > 0 && safeHeight > 0
    && safeWidth <= Math.floor(REPORT_IMAGE_MAX_PIXELS / safeHeight);
}

export function appendReportShareImage(
  groups: readonly ReportShareImageGroup[],
  groupId: string,
  fileUrl: string,
  existingImageUrls: readonly string[] = [],
): { groups: ReportShareImageGroup[]; imageUrls: string[] } | null {
  let found = false;
  const nextGroups = groups.map(group => {
    const urls = Array.isArray(group.urls) ? group.urls : [];
    if (group.id !== groupId) return { ...group, urls: [...urls] };
    found = true;
    return { ...group, urls: [...urls, fileUrl] };
  });
  if (!found) return null;

  const imageUrls = [...new Set([
    ...existingImageUrls,
    ...nextGroups.flatMap(group => group.urls),
  ])];
  return { groups: nextGroups, imageUrls };
}

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
