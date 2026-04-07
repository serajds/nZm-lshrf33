import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdminOrPM } from "../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import sharp from "sharp";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "logo-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".svg", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

async function compressLogo(filePath: string): Promise<string> {
  const baseName = path.basename(filePath, path.extname(filePath));
  const compressedName = baseName + "-compressed.jpg";
  const compressedPath = path.join(path.dirname(filePath), compressedName);

  await sharp(filePath)
    .rotate()
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(compressedPath);

  fs.unlinkSync(filePath);
  return compressedName;
}

const router: IRouter = Router();

router.get("/companies", requireAuth, async (_req, res): Promise<void> => {
  const companies = await db.select().from(companiesTable).orderBy(companiesTable.name);
  res.json(companies);
});

router.get("/companies/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "الشركة غير موجودة" });
    return;
  }
  res.json(company);
});

router.post("/companies", requireAdminOrPM, upload.single("logo"), async (req, res): Promise<void> => {
  const { name, type, phone, email, address } = req.body;

  if (!name || !type) {
    res.status(400).json({ error: "اسم الشركة ونوعها مطلوبان" });
    return;
  }

  let logoUrl: string | null = null;
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== ".svg") {
      try {
        const compressedFilename = await compressLogo(path.join(uploadsDir, req.file.filename));
        logoUrl = `/api/uploads/${compressedFilename}`;
      } catch {
        logoUrl = `/api/uploads/${req.file.filename}`;
      }
    } else {
      logoUrl = `/api/uploads/${req.file.filename}`;
    }
  }

  const [company] = await db.insert(companiesTable).values({
    name,
    type: type as "owner" | "contractor" | "supervisor",
    logoUrl,
    phone: phone || null,
    email: email || null,
    address: address || null,
  }).returning();

  res.status(201).json(company);
});

router.patch("/companies/:id", requireAdminOrPM, upload.single("logo"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  if (body.name !== undefined) updateData.name = body.name || null;
  if (body.type !== undefined) updateData.type = body.type || null;
  if (body.phone !== undefined) updateData.phone = body.phone || null;
  if (body.email !== undefined) updateData.email = body.email || null;
  if (body.address !== undefined) updateData.address = body.address || null;

  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== ".svg") {
      try {
        const compressedFilename = await compressLogo(path.join(uploadsDir, req.file.filename));
        updateData.logoUrl = `/api/uploads/${compressedFilename}`;
      } catch {
        updateData.logoUrl = `/api/uploads/${req.file.filename}`;
      }
    } else {
      updateData.logoUrl = `/api/uploads/${req.file.filename}`;
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [company] = await db.update(companiesTable).set(updateData).where(eq(companiesTable.id, id)).returning();
  if (!company) {
    res.status(404).json({ error: "الشركة غير موجودة" });
    return;
  }

  res.json(company);
});

router.delete("/companies/:id", requireAdminOrPM, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "الشركة غير موجودة" });
    return;
  }

  if (company.logoUrl) {
    const filename = company.logoUrl.split("/").pop();
    if (filename) {
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  await db.delete(companiesTable).where(eq(companiesTable.id, id));
  res.json({ success: true });
});

export default router;
