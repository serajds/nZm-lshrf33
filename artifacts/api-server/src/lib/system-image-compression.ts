import fs from "node:fs";
import path from "node:path";
import { db, projectFilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { cloudReportImageSource, uploadBufferToCloud } from "./fileStorage";
import type { SystemImageAssetKind } from "@workspace/db";
import { compressImageBuffer, ImageCompressionError, MAX_SOURCE_BYTES } from "./image-compression-core";

export type ImageCompressionOutcome =
  | { status: "compressed"; outputBytes: number; contentType: string }
  | { status: "skipped"; outputBytes: number; reason: string };

const uploadsDir = path.join(process.cwd(), "uploads");

function safeFilename(filename: string): string {
  if (!filename || path.basename(filename) !== filename || filename === "." || filename === "..") {
    throw new ImageCompressionError("invalid_filename");
  }
  return filename;
}

async function readOriginal(filename: string): Promise<{ buffer: Buffer; hadCloudObject: boolean }> {
  const localPath = path.join(uploadsDir, filename);
  if (process.env.NODE_ENV !== "production") {
    try {
      const stat = await fs.promises.stat(localPath);
      if (stat.size > MAX_SOURCE_BYTES) throw new ImageCompressionError("source_too_large");
      return { buffer: await fs.promises.readFile(localPath), hadCloudObject: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const cloud = await cloudReportImageSource(filename);
  if (cloud) {
    if (cloud.size > MAX_SOURCE_BYTES) throw new ImageCompressionError("source_too_large");
    const buffer = await cloud.read();
    if (buffer.length > MAX_SOURCE_BYTES) throw new ImageCompressionError("source_too_large");
    return { buffer, hadCloudObject: true };
  }

  try {
    const stat = await fs.promises.stat(localPath);
    if (stat.size > MAX_SOURCE_BYTES) throw new ImageCompressionError("source_too_large");
    return { buffer: await fs.promises.readFile(localPath), hadCloudObject: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ImageCompressionError("source_missing");
    }
    throw error;
  }
}

async function atomicWrite(localPath: string, buffer: Buffer): Promise<void> {
  const temporaryPath = `${localPath}.compress-${process.pid}-${Date.now()}`;
  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx" });
    await fs.promises.rename(temporaryPath, localPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function compressStoredImage(input: {
  filename: string;
  assetKinds: SystemImageAssetKind[];
}): Promise<ImageCompressionOutcome> {
  const filename = safeFilename(input.filename);
  const { buffer: original, hadCloudObject } = await readOriginal(filename);
  const compressed = await compressImageBuffer(original, input.assetKinds, filename);
  if (compressed.status === "skipped") {
    await db.update(projectFilesTable)
      .set({ fileSize: original.length })
      .where(eq(projectFilesTable.filename, filename));
    return compressed;
  }

  if (hadCloudObject || process.env.NODE_ENV === "production") {
    // Object storage replaces an object atomically. The local copy is also
    // updated when present because the upload-serving route prefers it.
    await uploadBufferToCloud(filename, compressed.buffer, compressed.contentType);
  }
  const localPath = path.join(uploadsDir, filename);
  try {
    const stat = await fs.promises.stat(localPath);
    if (stat.isFile()) await atomicWrite(localPath, compressed.buffer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!hadCloudObject) throw error;
  }

  await db.update(projectFilesTable)
    .set({ fileSize: compressed.outputBytes, mimeType: compressed.contentType })
    .where(eq(projectFilesTable.filename, filename));

  return {
    status: "compressed",
    outputBytes: compressed.outputBytes,
    contentType: compressed.contentType,
  };
}

export function imageCompressionFailureCode(error: unknown): string {
  if (error instanceof ImageCompressionError) return error.code;
  if (error instanceof Error && /too large/i.test(error.message)) return "source_too_large";
  const code = (error as { code?: string | number } | undefined)?.code;
  if (code === "ENOENT" || code === 404) return "source_missing";
  return "storage_or_database_error";
}

export const imageCompressionFailureLabels: Record<string, string> = {
  invalid_filename: "اسم ملف غير صالح",
  source_too_large: "حجم الصورة يتجاوز حد المعالجة الآمن",
  source_missing: "الملف غير موجود في التخزين",
  unreadable_image: "تعذر قراءة الصورة",
  invalid_dimensions: "أبعاد الصورة غير صالحة",
  pixel_limit: "أبعاد الصورة تتجاوز حد المعالجة الآمن",
  unsupported_format: "صيغة الصورة غير مدعومة للضغط الآمن",
  animated_image: "صورة متحركة؛ تم تجاوزها للحفاظ على الحركة",
  conversion_failed: "فشل ضغط الصورة",
  verification_failed: "تعذر التحقق من النسخة المضغوطة",
  storage_or_database_error: "تعذر حفظ الصورة أو تحديث بياناتها",
  already_compact: "الصورة صغيرة ومضغوطة بالفعل",
  no_size_saving: "لم ينتج الضغط حجماً أصغر، فتم الاحتفاظ بالأصل",
};
