import { eq } from "drizzle-orm";
import { db, imageAssetsTable } from "@workspace/db";
import { imageObjectName, UPLOADS_PREFIX, isLifecycleImageFilename } from "./image-asset-keys";
export { isLifecycleImageFilename } from "./image-asset-keys";
export type ImageReadUse = "primary" | "thumbnail" | "report" | "print";
export type StoredImageReadReference =
  | { kind: "legacy" }
  | { kind: "missing" }
  | { kind: "not_ready"; imageId: string }
  | { kind: "missing_derivative"; imageId: string }
  | { kind: "ready"; imageId: string; bucketId: string; storageKey: string; filename: string; mimeType: string };

/**
 * Internal reference resolution, AFTER existing consumer authorization. It
 * neither authorizes access itself nor decodes, converts, fetches or mutates
 * image content. Missing derivatives must not trigger read-time processing.
 */
export async function resolveStoredImageForRead(filename: string, use: ImageReadUse, projectId?: number): Promise<StoredImageReadReference> {
  if (!isLifecycleImageFilename(filename)) return { kind: "legacy" };
  const [asset] = await db.select().from(imageAssetsTable)
    .where(eq(imageAssetsTable.storageKey, UPLOADS_PREFIX + filename)).limit(1);
  if (!asset) return { kind: "missing" };
  if (projectId !== undefined && asset.projectId !== projectId) return { kind: "missing" };
  if (asset.state !== "ready" || !asset.storageBucket) return { kind: "not_ready", imageId: asset.id };
  let storageKey = asset.storageKey, state = asset.primaryState, mimeType = asset.mimeType;
  if (use === "thumbnail") {
    storageKey = asset.thumbnailKey; state = asset.thumbnailState; mimeType = storageKey?.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  } else if (use === "print" && asset.printKey) {
    storageKey = asset.printKey; state = asset.printState; mimeType = "image/jpeg";
  } else if (use === "report"
    && ["report", "report_detail", "report_technical", "file_image"].includes(asset.profile)
    && asset.printKey) {
    storageKey = asset.printKey; state = asset.printState; mimeType = "image/jpeg";
  }
  if (!storageKey || !mimeType || state !== "ready") return { kind: "missing_derivative", imageId: asset.id };
  return {
    kind: "ready", imageId: asset.id, bucketId: asset.storageBucket, storageKey,
    filename: imageObjectName(storageKey), mimeType,
  };
}
