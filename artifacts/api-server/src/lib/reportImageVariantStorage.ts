import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { deleteFromCloud, streamFromCloud, uploadToCloud } from "./fileStorage";
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
const persistInFlight = new Map<string, Promise<void>>();

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
    return [{ filename: `${prefix}.png`, contentType: "image/png" }];
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

    // Development stores derived copies locally. Only a published runtime
    // reads/writes them in Object Storage.
    if (isProduction) {
      const stored = await streamFromCloud(candidate.filename);
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
      if (isProduction) {
        try {
          await uploadToCloud(tempPath, candidate.filename);
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
): Promise<void> {
  assertSafeFilename(originalFilename);
  const sourcePath = path.join(uploadsDir, originalFilename);
  const stat = await fsp.stat(sourcePath);
  const key = `local:${originalFilename}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  const result = await reportImageVariant(key, variant, () => fsp.readFile(sourcePath));
  await persistVariant(originalFilename, variant, result, uploadsDir);
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
    ...candidateVariantFilenames(originalFilename, "report-logo"),
  ];
  await Promise.all(variants.map(async ({ filename }) => {
    await fsp.unlink(path.join(uploadsDir, filename)).catch(() => {});
    if (isProduction) await deleteFromCloud(filename);
  }));
}
