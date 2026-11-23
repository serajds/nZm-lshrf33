import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createSignedUploadObjectReadUrl,
  deleteFromCloud,
  getUploadObjectSize,
  streamFromCloud,
  uploadToCloud,
  uploadBufferToCloud,
} from "./fileStorage";
import { reportImageVariant, type ReportImageVariant } from "./reportImageVariants";

type StoredVariant = {
  stream: NodeJS.ReadableStream;
  contentType: string;
};

type VariantBytes = {
  buffer: Buffer;
  contentType: string;
};

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";
const persistInFlight = new Map<string, Promise<void>>();

export function reportPrintImageObjectName(originalFilename: string): string {
  assertSafeFilename(originalFilename);
  const environment = isProduction ? "production" : "development";
  const digest = createHash("sha256").update(originalFilename).digest("hex");
  return `report-print-100kb/${environment}/${digest}.jpg`;
}

export async function storeReportPrintImage(
  originalFilename: string,
  image: VariantBytes,
): Promise<void> {
  if (image.contentType !== "image/jpeg" || image.buffer.length > 100 * 1024) {
    throw new Error("Report print image must be JPEG and no larger than 100 KB");
  }
  await uploadBufferToCloud(reportPrintImageObjectName(originalFilename), image.buffer, image.contentType);
}

export async function reportPrintImageExists(originalFilename: string): Promise<boolean> {
  const size = await getUploadObjectSize(reportPrintImageObjectName(originalFilename));
  return size !== null && size <= 100 * 1024;
}

export async function signReportPrintImage(
  originalFilename: string,
  ttlSec = 300,
): Promise<string | null> {
  const objectName = reportPrintImageObjectName(originalFilename);
  if (!await reportPrintImageExists(originalFilename)) return null;
  return createSignedUploadObjectReadUrl(objectName, ttlSec);
}

function assertSafeFilename(filename: string): void {
  if (!filename || path.basename(filename) !== filename) {
    throw new Error("Invalid report image filename");
  }
}

function candidateVariantFilenames(
  originalFilename: string,
  variant: ReportImageVariant,
): Array<{ filename: string; contentType: string }> {
  // Upload names are unique and immutable, so the original filename identifies
  // the source version while keeping derivatives easy to find and clean up.
  const prefix = `report-preview-${variant}-${originalFilename}`;
  if (variant === "report-logo") {
    // Small JPEG/WebP logos may be returned unchanged by the variant
    // processor. Keep those supported formats instead of failing persistence.
    return [
      { filename: `${prefix}.png`, contentType: "image/png" },
      { filename: `${prefix}.jpg`, contentType: "image/jpeg" },
      { filename: `${prefix}.webp`, contentType: "image/webp" },
    ];
  }
  return [
    { filename: `${prefix}.jpg`, contentType: "image/jpeg" },
    { filename: `${prefix}.png`, contentType: "image/png" },
    { filename: `${prefix}.webp`, contentType: "image/webp" },
  ];
}

export async function findStoredReportImageVariant(
  originalFilename: string,
  variant: ReportImageVariant,
  uploadsDir: string,
): Promise<StoredVariant | null> {
  assertSafeFilename(originalFilename);
  for (const candidate of candidateVariantFilenames(originalFilename, variant)) {
    const localPath = path.join(uploadsDir, candidate.filename);
    try {
      const stat = await fsp.stat(localPath);
      if (stat.isFile()) {
        return { stream: fs.createReadStream(localPath), contentType: candidate.contentType };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (isProduction || (isDevelopment && variant === "report-photo")) {
      const cloudFilename = cloudVariantFilename(originalFilename, variant, candidate);
      const stored = await streamFromCloud(cloudFilename);
      if (stored) {
        return {
          stream: stored.stream,
          contentType: stored.contentType ?? candidate.contentType,
        };
      }
    }
  }
  return null;
}

function cloudVariantFilename(
  originalFilename: string,
  variant: ReportImageVariant,
  candidate: { filename: string; contentType: string },
): string {
  if (isDevelopment) {
    const extension = path.extname(candidate.filename);
    return `report-preview-dev-${variant}-${originalFilename}${extension}`;
  }
  return candidate.filename;
}

async function persistVariant(
  originalFilename: string,
  variant: ReportImageVariant,
  image: VariantBytes,
  uploadsDir: string,
): Promise<void> {
  const candidate = candidateVariantFilenames(originalFilename, variant)
    .find(item => item.contentType === image.contentType);
  if (!candidate) throw new Error("Unsupported report image variant type");

  const existing = persistInFlight.get(candidate.filename);
  if (existing) return existing;

  const task = (async () => {
    await fsp.mkdir(uploadsDir, { recursive: true });
    const localPath = path.join(uploadsDir, candidate.filename);
    const tempPath = path.join(uploadsDir, `.${candidate.filename}.${randomUUID()}.tmp`);
    await fsp.writeFile(tempPath, image.buffer, { flag: "wx" });
    try {
      let cloudError: unknown;
      if (isProduction || (isDevelopment && variant === "report-photo")) {
        try {
          await uploadToCloud(tempPath, cloudVariantFilename(originalFilename, variant, candidate));
        } catch (error) {
          cloudError = error;
        }
      }
      await fsp.rename(tempPath, localPath);
      if (cloudError) throw cloudError;
    } finally {
      await fsp.unlink(tempPath).catch(() => {});
    }
  })();
  persistInFlight.set(candidate.filename, task);
  try {
    await task;
  } finally {
    persistInFlight.delete(candidate.filename);
  }
}

export async function createAndStoreReportImageVariant(
  originalFilename: string,
  variant: ReportImageVariant,
  uploadsDir: string,
): Promise<VariantBytes> {
  assertSafeFilename(originalFilename);
  const sourcePath = path.join(uploadsDir, originalFilename);
  const stat = await fsp.stat(sourcePath);
  const key = `local:${originalFilename}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  const result = await reportImageVariant(key, variant, () => fsp.readFile(sourcePath));
  await persistVariant(originalFilename, variant, result, uploadsDir);
  return result;
}

export async function storeReportImageVariant(
  originalFilename: string,
  variant: ReportImageVariant,
  image: VariantBytes,
  uploadsDir: string,
): Promise<void> {
  assertSafeFilename(originalFilename);
  await persistVariant(originalFilename, variant, image, uploadsDir);
}

export async function deleteStoredReportImageVariants(
  originalFilename: string,
  uploadsDir: string,
): Promise<void> {
  assertSafeFilename(originalFilename);
  const variants = [
    ...candidateVariantFilenames(originalFilename, "report-photo"),
    ...candidateVariantFilenames(originalFilename, "report-thumbnail"),
    ...candidateVariantFilenames(originalFilename, "report-logo"),
  ];
  await Promise.all(variants.map(async ({ filename }) => {
    await fsp.unlink(path.join(uploadsDir, filename)).catch(() => {});
    if (isProduction) await deleteFromCloud(filename);
  }));
  if (isDevelopment) {
    await Promise.all(candidateVariantFilenames(originalFilename, "report-photo")
      .map(candidate => deleteFromCloud(cloudVariantFilename(originalFilename, "report-photo", candidate))));
  }
  if (isProduction || isDevelopment) {
    await deleteFromCloud(reportPrintImageObjectName(originalFilename));
  }
}
