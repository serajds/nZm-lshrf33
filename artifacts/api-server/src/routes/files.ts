import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectFilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit, requireTabView } from "../middlewares/tab-access";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { uploadToCloud, deleteFromCloud } from "../lib/fileStorage";
import { isValidBase64String } from "../lib/base64-validation";
import { reportsTable, reportImageSharesTable } from "@workspace/db";
import {
  createAndStoreReportImageVariant,
  deleteStoredReportImageVariants,
  storeReportPrintImage,
} from "../lib/reportImageVariantStorage";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".tif"];
const IMAGE_QUALITY = 80;

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(filename).toLowerCase());
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function compressImage(filePath: string): Promise<{ size: number; filename: string }> {
  const baseName = path.basename(filePath, path.extname(filePath));
  const compressedName = baseName + "-compressed.jpg";
  const compressedPath = path.join(path.dirname(filePath), compressedName);

  let pipeline = sharp(filePath).rotate();

  pipeline = pipeline.jpeg({ quality: IMAGE_QUALITY, mozjpeg: true });
  await pipeline.toFile(compressedPath);

  // Async I/O — was blocking the event loop on every upload.
  await fsp.unlink(filePath);
  const stats = await fsp.stat(compressedPath);
  return { size: stats.size, filename: compressedName };
}

const router: IRouter = Router();

router.get("/projects/:projectId/files", requireProjectAccess("projectId"), rejectContractor, requireTabView("files"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { category } = req.query;

  let query = db.select().from(projectFilesTable).where(eq(projectFilesTable.projectId, projectId));

  if (category && typeof category === "string") {
    query = db.select().from(projectFilesTable)
      .where(and(
        eq(projectFilesTable.projectId, projectId),
        eq(projectFilesTable.category, category as "image" | "pdf" | "test_result" | "document" | "other")
      ));
  }

  const files = await query.orderBy(projectFilesTable.uploadedAt);
  res.json(files);
});

// Shared persist + cloud-upload step used by both the generic Files-tab
// upload endpoint AND the report-images upload endpoint below. Centralized
// so the two entry points stay in sync (compression rules, storage layout,
// DB columns) — the only thing that differs is which tab gates the route.
export async function persistUploadedFile(
  file: Express.Multer.File,
  projectId: number,
  category: "image" | "pdf" | "test_result" | "document" | "other",
  description: string | null,
) {
  let finalFilename = file.filename;
  let finalSize = file.size;
  let finalMimeType = file.mimetype;

  if (isImageFile(file.originalname)) {
    try {
      const originalSize = file.size;
      const result = await compressImage(path.join(uploadsDir, file.filename));
      finalFilename = result.filename;
      finalSize = result.size;
      finalMimeType = "image/jpeg";
      const savedPercent = Math.round((1 - result.size / originalSize) * 100);
      console.log(`Image compressed: ${file.originalname} ${(originalSize / 1024).toFixed(0)}KB → ${(result.size / 1024).toFixed(0)}KB (${savedPercent}% saved)`);
    } catch (err) {
      console.warn("Image compression failed, using original:", err);
    }
  }

  try {
    await uploadToCloud(path.join(uploadsDir, finalFilename), finalFilename);
  } catch (err) {
    console.error("Cloud upload failed, file saved locally only:", err);
  }
  if (category === "image" && isImageFile(finalFilename)) {
    try {
      const printImage = await createAndStoreReportImageVariant(finalFilename, "report-photo", uploadsDir);
      await storeReportPrintImage(finalFilename, printImage);
    } catch (err) {
      console.warn("Report preview copy could not be prepared during upload:", err);
    }
    try {
      await createAndStoreReportImageVariant(finalFilename, "report-thumbnail", uploadsDir);
    } catch (err) {
      console.warn("Report thumbnail could not be prepared during upload:", err);
    }
  }

  const fileUrl = `/api/uploads/${finalFilename}`;

  const [row] = await db.insert(projectFilesTable).values({
    projectId,
    filename: finalFilename,
    originalName: file.originalname,
    category,
    fileUrl,
    fileSize: finalSize,
    mimeType: finalMimeType,
    description: description ?? null,
  }).returning();

  return row;
}

const REPORT_SHARE_MAX_BYTES = 15 * 1024 * 1024;
const REPORT_SHARE_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/tiff": ".tiff",
};

async function persistReportShareImage(
  buffer: Buffer,
  originalName: string,
  projectId: number,
  mimeType: string,
) {
  const extension = REPORT_SHARE_MIME_EXTENSIONS[mimeType];
  if (!extension || buffer.length === 0 || buffer.length > REPORT_SHARE_MAX_BYTES) {
    throw new Error("نوع الصورة أو حجمها غير مقبول");
  }
  const metadata = await sharp(buffer, { limitInputPixels: 100_000_000 }).metadata();
  const formatMime: Record<string, string> = {
    jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    heif: mimeType, tiff: "image/tiff",
  };
  if (!metadata.format || formatMime[metadata.format] !== mimeType) {
    throw new Error("محتوى الملف لا يطابق نوع الصورة");
  }
  const filename = `report-share-${randomUUID()}${extension}`;
  const filepath = path.join(uploadsDir, filename);
  await fsp.writeFile(filepath, buffer, { flag: "wx" });
  try {
    const row = await persistUploadedFile({
      fieldname: "file",
      originalname: path.basename(originalName || `صورة${extension}`).slice(0, 180),
      encoding: "7bit",
      mimetype: mimeType,
      destination: uploadsDir,
      filename,
      path: filepath,
      size: buffer.length,
      buffer,
      stream: undefined,
    } as unknown as Express.Multer.File, projectId, "image", "صورة قسم تقرير");
    return row;
  } catch (error) {
    await fsp.unlink(filepath).catch(() => {});
    throw error;
  }
}

async function discardPersistedReportImage(fileId: number, filename: string): Promise<void> {
  await db.delete(projectFilesTable).where(eq(projectFilesTable.id, fileId));
  await fsp.unlink(path.join(uploadsDir, filename)).catch(() => {});
  await deleteFromCloud(filename);
  await deleteStoredReportImageVariants(filename, uploadsDir);
}

const reportShareTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

router.post("/public/report-image-shares/upload", async (req, res): Promise<void> => {
  const token = req.body?.token;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    res.status(410).json({ error: "الرابط غير صالح أو انتهت صلاحيته" });
    return;
  }
  const [share] = await db.select().from(reportImageSharesTable)
    .where(eq(reportImageSharesTable.tokenHash, reportShareTokenHash(token)))
    .limit(1);
  if (!share || share.status === "completed" || share.status === "cancelled" || share.expiresAt <= new Date()) {
    res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إلغاؤه أو إكمال الرفع" });
    return;
  }
  const base64 = req.body?.imageBase64;
  const mimeType = req.body?.mimeType;
  const originalName = typeof req.body?.fileName === "string" ? req.body.fileName : "صورة";
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > Math.ceil(REPORT_SHARE_MAX_BYTES * 4 / 3) + 8
    || !isValidBase64String(base64)) {
    res.status(400).json({ error: "بيانات الصورة غير صالحة أو تجاوزت الحجم المسموح" });
    return;
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    res.status(400).json({ error: "تعذّر قراءة الصورة" });
    return;
  }
  if (buffer.length > REPORT_SHARE_MAX_BYTES) {
    res.status(413).json({ error: "الحد الأقصى لحجم الصورة 15 ميغابايت" });
    return;
  }

  let file: Awaited<ReturnType<typeof persistReportShareImage>>;
  try {
    file = await persistReportShareImage(buffer, originalName, share.projectId, mimeType);
  } catch (error) {
    const message = error instanceof Error && /حجمها|نوع الصورة|محتوى الملف/.test(error.message)
      ? error.message : "تعذّر رفع الصورة؛ تحقق من الملف وحاول مرة أخرى";
    res.status(400).json({ error: message });
    return;
  }

  let attached = false;
  try {
    attached = await db.transaction(async (tx) => {
      const [lockedShare] = await tx.select().from(reportImageSharesTable)
        .where(eq(reportImageSharesTable.id, share.id)).for("update");
      if (!lockedShare || lockedShare.status === "completed" || lockedShare.status === "cancelled"
        || lockedShare.expiresAt <= new Date()) return false;
      const [report] = await tx.select().from(reportsTable)
        .where(and(
          eq(reportsTable.id, lockedShare.reportId),
          eq(reportsTable.projectId, lockedShare.projectId),
        )).for("update");
      if (!report || !Array.isArray(report.imageGroups)) return false;
      const groups = (report.imageGroups as Array<{ id?: string; category: string; urls: string[] }>)
        .map(group => ({ ...group, urls: Array.isArray(group.urls) ? group.urls : [] }));
      const target = groups.find(group => group.id === lockedShare.groupId);
      if (!target) return false;
      target.urls = [...target.urls, file.fileUrl];
      const allUrls = [...new Set(groups.flatMap(group => group.urls))];
      await tx.update(reportsTable).set({ imageGroups: groups, imageUrls: allUrls })
        .where(eq(reportsTable.id, report.id));
      await tx.update(reportImageSharesTable).set({ status: "uploading" })
        .where(eq(reportImageSharesTable.id, lockedShare.id));
      return true;
    });
  } catch (error) {
    await discardPersistedReportImage(file.id, file.filename);
    req.log.error({ error }, "Could not attach report image from a share link");
    res.status(500).json({ error: "تعذّر ربط الصورة بالقسم؛ حاول مرة أخرى" });
    return;
  }
  if (!attached) {
    await discardPersistedReportImage(file.id, file.filename);
    res.status(410).json({ error: "انتهت صلاحية الرابط أو لم يعد القسم متاحاً" });
    return;
  }
  res.status(201).json({ uploaded: true });
});

router.post("/projects/:projectId/files", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("files"), upload.single("file"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  if (!req.file) {
    res.status(400).json({ error: "الملف مطلوب" });
    return;
  }

  const { category, description } = req.body;
  if (!category) {
    res.status(400).json({ error: "نوع الملف مطلوب" });
    return;
  }

  const row = await persistUploadedFile(
    req.file,
    projectId,
    category as "image" | "pdf" | "test_result" | "document" | "other",
    description ?? null,
  );

  res.status(201).json(row);
});

// Dedicated upload endpoint for images attached to project reports. It is
// gated by the "reports" tab edit permission instead of "files" — engineers
// who can edit the Reports tab but NOT the Files tab were previously
// blocked with a 403 when trying to attach photos to a report. Files
// uploaded here still land in the same projectFilesTable (so they show up
// in the project's file inventory and get the same cloud-storage treatment),
// just gated under a different tab.
router.post(
  "/projects/:projectId/reports/uploads",
  requireProjectAccess("projectId"),
  rejectContractor,
  rejectViewer,
  requireTabEdit("reports"),
  upload.single("file"),
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(raw, 10);

    if (!req.file) {
      res.status(400).json({ error: "الملف مطلوب" });
      return;
    }

    const description =
      typeof req.body?.description === "string" ? req.body.description : "صورة تقرير";

    const row = await persistUploadedFile(req.file, projectId, "image", description);
    res.status(201).json(row);
  },
);

router.delete("/projects/:projectId/files/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("files"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [file] = await db.delete(projectFilesTable)
    .where(and(eq(projectFilesTable.id, id), eq(projectFilesTable.projectId, projectId)))
    .returning();

  if (!file) {
    res.status(404).json({ error: "الملف غير موجود" });
    return;
  }

  // Async unlink; ignore if missing.
  const filePath = path.join(uploadsDir, file.filename);
  await fsp.unlink(filePath).catch(() => {});
  await deleteFromCloud(file.filename);
  await deleteStoredReportImageVariants(file.filename, uploadsDir);

  res.sendStatus(204);
});

export default router;
