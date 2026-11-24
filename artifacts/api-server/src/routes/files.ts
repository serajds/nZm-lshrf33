import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectFilesTable } from "@workspace/db";
import { and, count, desc, eq, ilike, inArray, sql, sum } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit, requireTabView } from "../middlewares/tab-access";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { uploadToCloud, deleteFromCloud, isCloudStorageConfigured } from "../lib/fileStorage";
import { IMAGE_CLIENT_KEY_PATTERN, IMAGE_SOURCE_MAX_BYTES } from "@workspace/api-zod";
import {
  deleteStoredReportImageVariants,
} from "../lib/reportImageVariantStorage";
import { permanentlyDeleteReportImages } from "../lib/report-image-cleanup";
import { createImageLifecycle } from "../lib/image-lifecycle";
import { imageObjectName } from "../lib/image-asset-keys";
import { sendImageUploadError } from "../lib/image-upload-errors";
import { ImageProcessingError } from "../lib/image-processing";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tiff", ".tif", ".avif"];
const fileImageLifecycle = createImageLifecycle();

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

const router: IRouter = Router();

router.get("/projects/:projectId/files", requireProjectAccess("projectId"), rejectContractor, requireTabView("files"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const rawPage = req.query.page;
  const rawPageSize = req.query.pageSize;
  const rawCategory = req.query.category;
  const rawSearch = req.query.search;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const pageSize = rawPageSize === undefined ? 24 : Number(rawPageSize);
  const categories = ["image", "pdf", "test_result", "document", "other"] as const;

  if (!Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !Number.isSafeInteger((page - 1) * pageSize)) {
    res.status(400).json({ error: "رقم الصفحة يجب أن يكون موجباً، وحجم الصفحة بين 1 و100" });
    return;
  }
  if (rawCategory !== undefined
    && (typeof rawCategory !== "string" || !categories.includes(rawCategory as typeof categories[number]))) {
    res.status(400).json({ error: "تصنيف الملفات غير صالح" });
    return;
  }
  if (rawSearch !== undefined && (typeof rawSearch !== "string" || rawSearch.length > 200)) {
    res.status(400).json({ error: "عبارة البحث يجب ألا تتجاوز 200 حرف" });
    return;
  }

  const search = typeof rawSearch === "string" ? rawSearch.trim() : "";
  const projectFilter = eq(projectFilesTable.projectId, projectId);
  const filters = [];
  if (typeof rawCategory === "string") {
    filters.push(eq(projectFilesTable.category, rawCategory as typeof categories[number]));
  }
  if (search) {
    const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
    filters.push(ilike(projectFilesTable.originalName, `%${escapedSearch}%`));
  }
  const where = filters.length ? and(projectFilter, ...filters) : projectFilter;
  const aggregateFilter = filters.length ? and(...filters) : sql`true`;
  const offset = (page - 1) * pageSize;

  const [files, aggregateRows] = await Promise.all([
    db.select().from(projectFilesTable)
      .where(where)
      .orderBy(desc(projectFilesTable.uploadedAt), desc(projectFilesTable.id))
      .limit(pageSize)
      .offset(offset),
    db.select({
      filteredTotal: sql<number>`count(*) filter (where ${aggregateFilter})`.mapWith(Number),
      totalFiles: count(),
      totalSize: sum(projectFilesTable.fileSize),
      imageCount: sql<number>`count(*) filter (where ${projectFilesTable.category} = 'image')`.mapWith(Number),
      pdfCount: sql<number>`count(*) filter (where ${projectFilesTable.category} = 'pdf')`.mapWith(Number),
      testResultCount: sql<number>`count(*) filter (where ${projectFilesTable.category} = 'test_result')`.mapWith(Number),
      documentCount: sql<number>`count(*) filter (where ${projectFilesTable.category} = 'document')`.mapWith(Number),
      otherCount: sql<number>`count(*) filter (where ${projectFilesTable.category} = 'other')`.mapWith(Number),
    }).from(projectFilesTable).where(projectFilter),
  ]);
  const aggregate = aggregateRows[0];
  const total = Number(aggregate?.filteredTotal ?? 0);
  const summary = {
    totalFiles: Number(aggregate?.totalFiles ?? 0),
    totalSize: Number(aggregate?.totalSize ?? 0),
    categories: {
      image: Number(aggregate?.imageCount ?? 0),
      pdf: Number(aggregate?.pdfCount ?? 0),
      test_result: Number(aggregate?.testResultCount ?? 0),
      document: Number(aggregate?.documentCount ?? 0),
      other: Number(aggregate?.otherCount ?? 0),
    } satisfies Record<typeof categories[number], number>,
  };

  res.json({
    files,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    summary,
  });
});

// Shared persist + cloud-upload step used by both the generic Files-tab
// upload endpoint AND the report-images upload endpoint below. Centralized
// so the two entry points stay in sync (compression rules, storage layout,
// DB columns) — the only thing that differs is which tab gates the route.
type PersistedProjectFile = typeof projectFilesTable.$inferSelect;
type ProjectFileInsert = typeof projectFilesTable.$inferInsert;
type PersistUploadedFileOptions = {
  insertProjectFile?: (values: ProjectFileInsert) => Promise<PersistedProjectFile>;
  requireCloudStorage?: boolean;
};

async function cleanupUncommittedUpload(filename: string): Promise<void> {
  await fsp.unlink(path.join(uploadsDir, filename)).catch(() => {});
  await deleteFromCloud(filename);
  await deleteStoredReportImageVariants(filename, uploadsDir);
}

export async function persistUploadedFile(
  file: Express.Multer.File,
  projectId: number,
  category: "image" | "pdf" | "test_result" | "document" | "other",
  description: string | null,
  options: PersistUploadedFileOptions = {},
): Promise<PersistedProjectFile> {
  if (category === "image") throw new Error("Raster images must use the shared image lifecycle");
  let finalFilename = file.filename;
  let finalSize = file.size;
  let finalMimeType = file.mimetype;

  if (options.requireCloudStorage && !isCloudStorageConfigured()) {
    await cleanupUncommittedUpload(finalFilename);
    throw new Error("Object storage is not configured");
  }
  try {
    await uploadToCloud(path.join(uploadsDir, finalFilename), finalFilename);
  } catch (err) {
    if (options.requireCloudStorage) {
      await cleanupUncommittedUpload(finalFilename);
      throw new Error("Cloud upload failed", { cause: err });
    }
    console.error("Cloud upload failed, file saved locally only:", err);
  }
  const fileUrl = `/api/uploads/${finalFilename}`;

  const values: ProjectFileInsert = {
    projectId,
    filename: finalFilename,
    originalName: file.originalname,
    category,
    fileUrl,
    fileSize: finalSize,
    mimeType: finalMimeType,
    description: description ?? null,
  };
  try {
    if (options.insertProjectFile) return await options.insertProjectFile(values);
    const [row] = await db.insert(projectFilesTable).values(values).returning();
    return row;
  } catch (error) {
    await cleanupUncommittedUpload(finalFilename);
    throw error;
  }
}

router.post("/projects/:projectId/files", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("files"), upload.single("file"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  if (!req.file) {
    res.status(400).json({ error: "الملف مطلوب" });
    return;
  }

  const { category, description } = req.body;
  if (!["image", "pdf", "test_result", "document", "other"].includes(category)) {
    res.status(400).json({ error: "نوع الملف مطلوب" });
    return;
  }
  if (category === "image") {
    const sourcePath = req.file.path;
    const originalName = path.basename(req.file.originalname.replace(/\\/g, "/"))
      .replace(/[\0\r\n]/g, "").slice(0, 255);
    const rawClientKey = req.get("Idempotency-Key");
    const clientKey = rawClientKey || randomUUID();
    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (!isImageFile(originalName)) throw new ImageProcessingError("unsupported_format");
      if (req.file.size > IMAGE_SOURCE_MAX_BYTES) throw new ImageProcessingError("source_size_limit");
      if (!IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) throw new ImageProcessingError("invalid_image_identity");
      const userId = req.user!.userId;
      const result = await fileImageLifecycle.upload({
        principal: `user:${userId}`, authorizedScope: `project:${projectId}:files`,
        projectId, userId, clientKey, profile: "file_image", sourcePath,
        signal: controller.signal,
        onCommit: async (tx, asset) => {
          const filename = imageObjectName(asset.storageKey!);
          const [row] = await tx.insert(projectFilesTable).values({
            projectId, filename, originalName, category: "image",
            fileUrl: `/api/uploads/${filename}`, fileSize: asset.byteSize!,
            mimeType: asset.mimeType!, description: typeof description === "string" ? description.slice(0, 500) : null,
          }).returning({ id: projectFilesTable.id });
          return row?.id ?? null;
        },
      });
      if (!result.projectFileId) throw new ImageProcessingError("image_reference_removed");
      const [row] = await db.select().from(projectFilesTable).where(eq(projectFilesTable.id, result.projectFileId));
      if (!row) throw new ImageProcessingError("image_reference_removed");
      res.status(201).json({ ...row, image: result.image });
    } catch (error) {
      sendImageUploadError(res, error);
    } finally {
      await fsp.unlink(sourcePath).catch(() => {});
    }
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

router.delete(
  "/projects/:projectId/files/images/bulk",
  requireProjectAccess("projectId"),
  rejectContractor,
  rejectViewer,
  requireTabEdit("files"),
  async (req, res): Promise<void> => {
    const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const projectId = parseInt(rawProjectId, 10);
    const rawIds: unknown = req.body?.ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 100
      || rawIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      res.status(400).json({ error: "حدد من صورة واحدة إلى 100 صورة صالحة" });
      return;
    }
    const ids = [...new Set(rawIds as number[])];
    const files = await db.select({
      id: projectFilesTable.id,
      category: projectFilesTable.category,
      fileUrl: projectFilesTable.fileUrl,
    }).from(projectFilesTable).where(and(
      eq(projectFilesTable.projectId, projectId),
      inArray(projectFilesTable.id, ids),
    ));
    if (files.length !== ids.length) {
      res.status(409).json({ error: "تغيرت قائمة الصور؛ حدّث الصفحة ثم أعد التحديد" });
      return;
    }
    if (files.some(file => file.category !== "image")) {
      res.status(400).json({ error: "يمكن حذف الصور فقط من خلال هذا الإجراء" });
      return;
    }
    try {
      const deletedCount = await permanentlyDeleteReportImages(
        projectId,
        files.map(file => file.fileUrl),
      );
      res.json({ requestedCount: files.length, deletedCount });
    } catch (error) {
      req.log.error({ error, projectId, fileIds: ids }, "Could not bulk delete project images");
      res.status(500).json({ error: "تعذّر إكمال حذف الصور؛ حدّث القائمة وتحقق من الصور المتبقية" });
    }
  },
);

router.delete("/projects/:projectId/files/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("files"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [existing] = await db.select({
    id: projectFilesTable.id,
    category: projectFilesTable.category,
    fileUrl: projectFilesTable.fileUrl,
  }).from(projectFilesTable).where(and(
    eq(projectFilesTable.id, id),
    eq(projectFilesTable.projectId, projectId),
  ));
  if (!existing) {
    res.status(404).json({ error: "الملف غير موجود" });
    return;
  }

  if (existing.category === "image") {
    try {
      const deletedCount = await permanentlyDeleteReportImages(projectId, [existing.fileUrl]);
      if (deletedCount !== 1) {
        res.status(409).json({ error: "لم يتم حذف الصورة من الملفات؛ قد تكون غير قابلة للحذف أو مرتبطة بملف آخر" });
        return;
      }
    } catch (error) {
      req.log.error({ error, projectId, fileId: id }, "Could not delete project image");
      res.status(500).json({ error: "تعذّر حذف الصورة نهائياً؛ حاول مرة أخرى" });
      return;
    }
    res.sendStatus(204);
    return;
  }

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
