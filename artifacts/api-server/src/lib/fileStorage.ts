import { objectStorageClient } from "./objectStorage";
import fs from "fs";
import path from "path";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const UPLOADS_PREFIX = "uploads/";

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

export async function deleteFromCloud(filename: string): Promise<void> {
  if (!BUCKET_ID) return;
  try {
    await getBucket().file(UPLOADS_PREFIX + filename).delete({ ignoreNotFound: true });
  } catch (err) {
    console.error("Cloud delete failed for", filename, err);
  }
}

export async function migrateExistingUploads(uploadsDir: string): Promise<void> {
  if (!BUCKET_ID) return;
  if (!fs.existsSync(uploadsDir)) return;
  const files = fs.readdirSync(uploadsDir);
  if (files.length === 0) return;

  console.log(`Migrating ${files.length} existing uploads to cloud storage...`);
  let migrated = 0;
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
      console.error(`Failed to migrate ${filename}:`, err);
    }
  }
  console.log(`Migration complete: ${migrated} files uploaded to cloud storage`);
}
