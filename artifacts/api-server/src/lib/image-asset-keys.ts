export const UPLOADS_PREFIX = "uploads/";
const uuidText = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const uuid = new RegExp(`^${uuidText}$`);
const primary = new RegExp(`^image-${uuidText}-${uuidText}\\.(?:jpg|png|webp)$`);
const owned = new RegExp(`^image-${uuidText}-${uuidText}(?:-thumb|-print)?\\.(?:jpg|png|webp)$`);
export const isLifecycleImageFilename = (filename: string) => primary.test(filename);
export const isLifecycleImageObjectFilename = (filename: string) => owned.test(filename);
export function imageAssetObjectKeys(id: string, attemptToken: string, mimeType: string, thumbnailMimeType = "image/webp", primaryIsPrint = false) {
  if (!uuid.test(id) || !uuid.test(attemptToken)) throw new Error("invalid_image_identity");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mimeType];
  if (typeof extension !== "string") throw new Error("unsupported_image_output_type");
  const stem = `image-${id}-${attemptToken}`;
  return {
    primary: `${UPLOADS_PREFIX}${stem}.${extension}`,
    thumbnail: `${UPLOADS_PREFIX}${stem}-thumb.${thumbnailMimeType === "image/jpeg" ? "jpg" : "webp"}`,
    print: primaryIsPrint && mimeType === "image/jpeg" ? `${UPLOADS_PREFIX}${stem}.${extension}` : `${UPLOADS_PREFIX}${stem}-print.jpg`,
  };
}
export function imageObjectName(storageKey: string) {
  if (!storageKey.startsWith(UPLOADS_PREFIX)) throw new Error("invalid_image_storage_key");
  const name = storageKey.slice(UPLOADS_PREFIX.length);
  if (!/^image-[a-f0-9-]+(?:-thumb|-print)?\.(?:jpg|png|webp)$/.test(name)) throw new Error("invalid_image_storage_key");
  return name;
}
