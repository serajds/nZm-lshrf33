import { objectStorageClient, signObjectURL } from "./objectStorage";
import fs from "fs";
import path from "path";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const UPLOADS_PREFIX = "uploads/";

export function isCloudStorageConfigured(): boolean {
  return Boolean(BUCKET_ID);
}

function getBucket() {
  return objectStorageClient.bucket(BUCKET_ID);
}

export async function uploadToCloud(localPath: string, filename: string): Promise<void> {
  if (!BUCKET_ID) {
    console.warn("No object storage bucket configured, skipping cloud upload");
    return;
  }
  const destination = UPLOADS_PREFIX + filename;
  await getBucket().upload(localPath, {
    destination,
    resumable: false,
  });
}

export async function createSignedUploadReadUrl(filename: string, ttlSec = 300): Promise<string> {
  if (!BUCKET_ID) throw new Error("Object storage bucket is not configured");
  if (!filename || path.basename(filename) !== filename || filename === "." || filename === "..") {
    throw new Error("Invalid upload filename");
  }
  return signObjectURL({
    bucketName: BUCKET_ID,
    objectName: UPLOADS_PREFIX + filename,
    method: "GET",
    ttlSec,
  });
}

export async function createSignedUploadObjectReadUrl(objectName: string, ttlSec = 300): Promise<string> {
  if (!BUCKET_ID) throw new Error("Object storage bucket is not configured");
  const segments = objectName.split("/");
  if (!objectName || objectName.startsWith("/") || segments.some(segment =>
    !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0")
  )) {
    throw new Error("Invalid upload object name");
  }
  return signObjectURL({
    bucketName: BUCKET_ID,
    objectName: UPLOADS_PREFIX + objectName,
    method: "GET",
    ttlSec,
  });
}

export async function uploadBufferToCloud(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  if (!BUCKET_ID) throw new Error("Object storage bucket is not configured");
  const segments = objectName.split("/");
  if (!objectName || objectName.startsWith("/") || segments.some(segment =>
    !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0")
  )) {
    throw new Error("Invalid upload object name");
  }
  await getBucket().file(UPLOADS_PREFIX + objectName).save(buffer, {
    resumable: false,
    metadata: { contentType, cacheControl: "private, max-age=300" },
  });
}

export async function getUploadObjectSize(objectName: string): Promise<number | null> {
  if (!BUCKET_ID) throw new Error("Object storage bucket is not configured");
  const segments = objectName.split("/");
  if (!objectName || objectName.startsWith("/") || segments.some(segment =>
    !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0")
  )) {
    throw new Error("Invalid upload object name");
  }
  try {
    const [metadata] = await getBucket().file(UPLOADS_PREFIX + objectName).getMetadata();
    const size = Number(metadata.size);
    return Number.isFinite(size) && size >= 0 ? size : null;
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null;
    throw error;
  }
}

export async function listUploadedImageObjects(): Promise<Array<{
  filename: string;
  size: number;
  contentType: string | null;
}>> {
  if (!BUCKET_ID) return [];
  const [files] = await getBucket().getFiles({ prefix: UPLOADS_PREFIX, autoPaginate: true });
  const imageExtension = /\.(?:jpe?g|png|webp|gif|tiff?|heic|heif|avif|bmp|svg)$/i;
  const results: Array<{ filename: string; size: number; contentType: string | null }> = [];
  for (const file of files) {
    if (!file.name.startsWith(UPLOADS_PREFIX)) continue;
    const filename = file.name.slice(UPLOADS_PREFIX.length);
    // These are derived previews/print copies, not uploaded source images.
    if (filename.includes("/") || filename.startsWith("report-preview-")) continue;
    if (!imageExtension.test(filename)) continue;
    const size = Number(file.metadata?.size);
    results.push({
      filename,
      size: Number.isFinite(size) && size > 0 ? size : 0,
      contentType: file.metadata?.contentType ?? null,
    });
  }
  return results;
}

export async function streamFromCloud(filename: string): Promise<{ stream: NodeJS.ReadableStream; contentType: string | undefined } | null> {
  if (!BUCKET_ID) return null;
  try {
    const file = getBucket().file(UPLOADS_PREFIX + filename);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const stream = file.createReadStream();
    return { stream, contentType: metadata.contentType as string | undefined };
  } catch (err) {
    console.error("Cloud download failed for", filename, err);
    return null;
  }
}

export async function deleteFromCloudStrict(filename: string): Promise<void> {
  if (!BUCKET_ID) return;
  await getBucket().file(UPLOADS_PREFIX + filename).delete({ ignoreNotFound: true });
}

export async function deleteFromCloud(filename: string): Promise<void> {
  try {
    await deleteFromCloudStrict(filename);
  } catch (err) {
    console.error("Cloud delete failed for", filename, err);
  }
}

/** Metadata is checked per request, so replaced objects never reuse an old variant. */
export async function cloudReportImageSource(filename: string): Promise<{
  version: string;
  size: number;
  contentType: string | null;
  read: () => Promise<Buffer>;
} | null> {
  if (!BUCKET_ID) return null;
  const file = getBucket().file(UPLOADS_PREFIX + filename);
  try {
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) > 25 * 1024 * 1024) throw new Error("Report image is too large");
    return {
      version: `${metadata.generation}:${metadata.metageneration}`,
      size: Number(metadata.size) || 0,
      contentType: typeof metadata.contentType === "string" ? metadata.contentType : null,
      // Pin to the inspected generation if the original is replaced concurrently.
      read: async () => {
        const [buffer] = await getBucket().file(UPLOADS_PREFIX + filename, {
          generation: metadata.generation,
        }).download();
        return buffer;
      },
    };
  } catch (error) {
    if ((error as { code?: number }).code === 404) return null;
    throw error;
  }
}

export async function migrateExistingUploads(uploadsDir: string): Promise<{
  scanned: number;
  migrated: number;
  failed: number;
  skipped: boolean;
}> {
  if (!BUCKET_ID || !fs.existsSync(uploadsDir)) {
    return { scanned: 0, migrated: 0, failed: 0, skipped: true };
  }
  const files = fs.readdirSync(uploadsDir);
  if (files.length === 0) {
    return { scanned: 0, migrated: 0, failed: 0, skipped: false };
  }

  console.log(`Migrating ${files.length} existing uploads to cloud storage...`);
  let migrated = 0;
  let failed = 0;
  for (const filename of files) {
    const filePath = path.join(uploadsDir, filename);
    if (!fs.statSync(filePath).isFile()) continue;
    try {
      const destination = UPLOADS_PREFIX + filename;
      const [exists] = await getBucket().file(destination).exists();
      if (!exists) {
        await getBucket().upload(filePath, { destination, resumable: false });
        migrated++;
      }
    } catch (err) {
      failed++;
      console.error(`Failed to migrate ${filename}:`, err);
    }
  }
  console.log(`Migration complete: ${migrated} files uploaded, ${failed} failed`);
  return { scanned: files.length, migrated, failed, skipped: false };
}
