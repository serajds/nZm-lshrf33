import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createSignedUploadObjectReadUrl,
  deleteFromCloud,
  getUploadObjectSize,
  streamFromCloud,
} from "./fileStorage";
type ReportImageVariant = "report-photo" | "report-thumbnail" | "report-logo";

type StoredVariant = {
  stream: NodeJS.ReadableStream;
  contentType: string;
};

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";

export function reportPrintImageObjectName(originalFilename: string): string {
  assertSafeFilename(originalFilename);
  const environment = isProduction ? "production" : "development";
  const digest = createHash("sha256").update(originalFilename).digest("hex");
  return `report-print-v3/${environment}/${digest}.jpg`;
}

export async function reportPrintImageExists(originalFilename: string): Promise<boolean> {
  const size = await getUploadObjectSize(reportPrintImageObjectName(originalFilename));
  return size !== null && size <= 1536 * 1024;
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
  const prefix = `report-preview-v3-${variant}-${originalFilename}`;
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
