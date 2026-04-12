import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectFilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireProjectAccess, rejectContractor } from "../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { uploadToCloud, deleteFromCloud } from "../lib/fileStorage";

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

  fs.unlinkSync(filePath);

  const stats = fs.statSync(compressedPath);
  return { size: stats.size, filename: compressedName };
}

const router: IRouter = Router();

router.get("/projects/:projectId/files", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
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

router.post("/projects/:projectId/files", requireProjectAccess("projectId"), rejectContractor, upload.single("file"), async (req, res): Promise<void> => {
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

  let finalFilename = req.file.filename;
  let finalSize = req.file.size;
  let finalMimeType = req.file.mimetype;

  if (isImageFile(req.file.originalname)) {
    try {
      const originalSize = req.file.size;
      const result = await compressImage(path.join(uploadsDir, req.file.filename));
      finalFilename = result.filename;
      finalSize = result.size;
      finalMimeType = "image/jpeg";
      const savedPercent = Math.round((1 - result.size / originalSize) * 100);
      console.log(`Image compressed: ${req.file.originalname} ${(originalSize / 1024).toFixed(0)}KB → ${(result.size / 1024).toFixed(0)}KB (${savedPercent}% saved)`);
    } catch (err) {
      console.warn("Image compression failed, using original:", err);
    }
  }

  try {
    await uploadToCloud(path.join(uploadsDir, finalFilename), finalFilename);
  } catch (err) {
    console.error("Cloud upload failed, file saved locally only:", err);
  }

  const fileUrl = `/api/uploads/${finalFilename}`;

  const [file] = await db.insert(projectFilesTable).values({
    projectId,
    filename: finalFilename,
    originalName: req.file.originalname,
    category: category as "image" | "pdf" | "test_result" | "document" | "other",
    fileUrl,
    fileSize: finalSize,
    mimeType: finalMimeType,
    description: description ?? null,
  }).returning();

  res.status(201).json(file);
});

router.delete("/projects/:projectId/files/:id", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
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

  const filePath = path.join(uploadsDir, file.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  await deleteFromCloud(file.filename);

  res.sendStatus(204);
});

export default router;
