import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectFilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
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

router.get("/projects/:projectId/files", requireAuth, async (req, res): Promise<void> => {
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

router.post("/projects/:projectId/files", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
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

  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  const fileUrl = `https://${baseUrl}/api/uploads/${req.file.filename}`;

  const [file] = await db.insert(projectFilesTable).values({
    projectId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    category: category as "image" | "pdf" | "test_result" | "document" | "other",
    fileUrl,
    fileSize: req.file.size,
    mimeType: req.file.mimetype,
    description: description ?? null,
  }).returning();

  res.status(201).json(file);
});

router.delete("/projects/:projectId/files/:id", requireAuth, async (req, res): Promise<void> => {
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

  res.sendStatus(204);
});

export default router;
