import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import { db } from "@workspace/db";
import { companiesTable, imageAssetsTable, projectMembersTable, projectsTable, userCompaniesTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { requireAuth, requireAdminOrPM } from "../middlewares/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { deleteFromCloud, deleteImageObjectStrict } from "../lib/fileStorage";
import { createImageLifecycle } from "../lib/image-lifecycle";
import { createImageUploadRequestMiddleware, imageUploadRequest } from "../lib/image-upload-request";
import { sendImageUploadError } from "../lib/image-upload-errors";
import { ImageProcessingError } from "../lib/image-processing";
import { IMAGE_CLIENT_KEY_PATTERN } from "@workspace/api-zod";
import { imageObjectName, isLifecycleImageFilename } from "../lib/image-asset-keys";
import { deleteStoredReportImageVariants } from "../lib/reportImageVariantStorage";

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
    const allowed = [".jpg", ".jpeg", ".png", ".svg", ".webp", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router: IRouter = Router();
const imageLifecycle = createImageLifecycle();
const imageIngress = createImageUploadRequestMiddleware({ temporaryRoot: uploadsDir });
type LogoImageCommit = NonNullable<Parameters<typeof imageLifecycle.upload>[0]["onCommit"]>;
const trackLogoUpload: RequestHandler = (req, res, next) => {
  if (req.file) imageUploadRequest(res)?.trackIncoming(req.file.path);
  next();
};
const companyTypes = ["owner", "contractor", "supervisor"] as const;
type CompanyType = (typeof companyTypes)[number];

async function saveManagedCompanyLogo(
  req: Request,
  res: Response,
  clientKey: string,
  scope: string,
  onCommit: LogoImageCommit,
): Promise<string> {
  if (!req.file) throw new ImageProcessingError("invalid_image_packet");
  const context = imageUploadRequest(res);
  if (!context) throw new ImageProcessingError("image_request_unavailable");
  const result = await context.run(() => imageLifecycle.upload({
    principal: `user:${req.user!.userId}`,
    authorizedScope: scope,
    projectId: null,
    userId: req.user!.userId,
    clientKey,
    profile: "logo",
    sourcePath: req.file!.path,
    signal: context.signal,
    lease: context.lease,
    onCommit,
  }));
  if (!result.image.storageKey) throw new ImageProcessingError("image_reference_removed");
  return result.fileUrl;
}

function isManagedCompanyLogo(filename: string): boolean {
  return /\.(?:jpe?g|png|webp|gif|svg)$/i.test(filename);
}

const memberCompanyFields = {
  id: companiesTable.id,
  name: companiesTable.name,
  type: companiesTable.type,
  logoUrl: companiesTable.logoUrl,
};

function parseCompanyId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function isCompanyType(value: unknown): value is CompanyType {
  return typeof value === "string" && companyTypes.includes(value as CompanyType);
}

async function getRelatedCompanyIds(userId: number, role: string | undefined): Promise<number[]> {
  const [memberships, linkedCompanies] = await Promise.all([
    db.select({ projectId: projectMembersTable.projectId, role: projectMembersTable.role })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, userId)),
    db.select({ companyId: userCompaniesTable.companyId })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, userId)),
  ]);
  const companyIds = new Set(linkedCompanies.map(link => link.companyId));

  // Mirror requireProjectAccess: a contractor-company link takes precedence
  // over an engineer membership, and a contractor membership is also limited.
  if (role !== "contractor" && memberships.length > 0) {
    const memberProjectIds = memberships.map(membership => membership.projectId);
    const memberProjects = await db.select({
      id: projectsTable.id,
      ownerCompanyId: projectsTable.ownerCompanyId,
      contractorCompanyId: projectsTable.contractorCompanyId,
      supervisorCompanyId: projectsTable.supervisorCompanyId,
    }).from(projectsTable).where(inArray(projectsTable.id, memberProjectIds));
    for (const project of memberProjects) {
      const membership = memberships.find(member => member.projectId === project.id);
      if (membership?.role === "contractor" || (project.contractorCompanyId !== null
        && companyIds.has(project.contractorCompanyId))) {
        if (project.contractorCompanyId !== null) companyIds.add(project.contractorCompanyId);
        continue;
      }
      if (project.ownerCompanyId !== null) companyIds.add(project.ownerCompanyId);
      if (project.contractorCompanyId !== null) companyIds.add(project.contractorCompanyId);
      if (project.supervisorCompanyId !== null) companyIds.add(project.supervisorCompanyId);
    }
  }

  return [...companyIds];
}

router.get("/companies", requireAuth, async (req, res): Promise<void> => {
  const role = req.user?.role;
  const userId = req.user?.userId;

  if (role === "admin") {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.name);
    res.json(companies);
  } else if (role === "project_manager") {
    const companies = await db.select().from(companiesTable)
      .where(eq(companiesTable.createdById, userId!))
      .orderBy(companiesTable.name);
    res.json(companies);
  } else {
    const companyIds = await getRelatedCompanyIds(userId!, role);
    const companies = companyIds.length > 0
      ? await db.select(memberCompanyFields).from(companiesTable)
        .where(inArray(companiesTable.id, companyIds)).orderBy(companiesTable.name)
      : [];
    res.json(companies);
  }
});

router.get("/companies/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseCompanyId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "معرف الشركة غير صالح" });
    return;
  }

  const role = req.user?.role;
  const userId = req.user?.userId!;
  if (role === "admin") {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!company) {
      res.status(404).json({ error: "الشركة غير موجودة" });
      return;
    }
    res.json(company);
    return;
  }

  if (role === "project_manager") {
    const [company] = await db.select().from(companiesTable)
      .where(eq(companiesTable.id, id));
    if (!company || company.createdById !== userId) {
      res.status(404).json({ error: "الشركة غير موجودة" });
      return;
    }
    res.json(company);
    return;
  }

  const companyIds = await getRelatedCompanyIds(userId, role);
  const [company] = companyIds.includes(id)
    ? await db.select(memberCompanyFields).from(companiesTable)
      .where(eq(companiesTable.id, id))
    : [];
  if (!company) {
    res.status(404).json({ error: "الشركة غير موجودة" });
    return;
  }
  res.json(company);
});

router.post("/companies", requireAdminOrPM, imageIngress, upload.single("logo"), trackLogoUpload, async (req, res): Promise<void> => {
  const { name, type, phone, email, address } = req.body;

  if (typeof name !== "string" || !name.trim() || !type) {
    res.status(400).json({ error: "اسم الشركة ونوعها مطلوبان" });
    return;
  }
  if (!isCompanyType(type)) {
    res.status(400).json({ error: "نوع الشركة غير صالح" });
    return;
  }

  let logoUrl: string | null = null;
  const companyValues = {
    name: name.trim(),
    type,
    phone: phone || null,
    email: email || null,
    address: address || null,
    createdById: req.user?.userId ?? null,
  };
  if (req.file && isManagedCompanyLogo(req.file.originalname)) {
    const clientKey = req.body?.clientKey;
    if (typeof clientKey !== "string" || !IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) {
      res.status(400).json({ error: "مفتاح رفع الشعار غير صالح" });
      return;
    }
    try {
      logoUrl = await saveManagedCompanyLogo(
        req, res, clientKey, `user:${req.user!.userId}:company-create`,
        async (tx, asset) => {
          const filename = imageObjectName(asset.storageKey!);
          await tx.insert(companiesTable).values({
            ...companyValues,
            logoUrl: `/api/uploads/${filename}`,
          });
          return null;
        },
      );
      const [company] = await db.select().from(companiesTable).where(eq(companiesTable.logoUrl, logoUrl));
      if (!company) throw new ImageProcessingError("image_reference_removed");
      res.status(201).json(company);
    } catch (error) {
      sendImageUploadError(res, error);
    }
    return;
  }
  const [company] = await db.insert(companiesTable).values({
    ...companyValues,
    logoUrl,
  }).returning();

  res.status(201).json(company);
});

router.patch("/companies/:id", requireAdminOrPM, async (req, res, next): Promise<void> => {
  const id = parseCompanyId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "معرف الشركة غير صالح" });
    return;
  }
  if (req.user?.role === "project_manager") {
    const [existing] = await db.select({ createdById: companiesTable.createdById })
      .from(companiesTable)
      .where(eq(companiesTable.id, id));
    if (!existing || existing.createdById !== req.user.userId) {
      res.status(403).json({ error: "لا يمكنك تعديل شركة لم تقم بإنشائها" });
      return;
    }
  }
  next();
}, imageIngress, upload.single("logo"), trackLogoUpload, async (req, res): Promise<void> => {
  const id = parseCompanyId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "معرف الشركة غير صالح" });
    return;
  }

  let existing: typeof companiesTable.$inferSelect | undefined;
  if (req.user?.role === "project_manager") {
    [existing] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!existing || existing.createdById !== req.user.userId) {
      res.status(403).json({ error: "لا يمكنك تعديل شركة لم تقم بإنشائها" });
      return;
    }
  }

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      res.status(400).json({ error: "اسم الشركة غير صالح" });
      return;
    }
    updateData.name = body.name.trim();
  }
  if (body.type !== undefined) {
    if (!isCompanyType(body.type)) {
      res.status(400).json({ error: "نوع الشركة غير صالح" });
      return;
    }
    if (req.user?.role === "project_manager" && existing?.type !== body.type) {
      res.status(403).json({ error: "لا يمكنك تغيير تصنيف الشركة" });
      return;
    }
    updateData.type = body.type;
  }
  if (body.phone !== undefined) updateData.phone = body.phone || null;
  if (body.email !== undefined) updateData.email = body.email || null;
  if (body.address !== undefined) updateData.address = body.address || null;

  if (req.file) {
    if (isManagedCompanyLogo(req.file.originalname)) {
      const clientKey = req.body?.clientKey;
      if (typeof clientKey !== "string" || !IMAGE_CLIENT_KEY_PATTERN.test(clientKey)) {
        res.status(400).json({ error: "مفتاح رفع الشعار غير صالح" });
        return;
      }
      try {
        const logoUrl = await saveManagedCompanyLogo(
          req, res, clientKey, `company:${id}:logo`,
          async (tx, asset) => {
            const filename = imageObjectName(asset.storageKey!);
            const [updated] = await tx.update(companiesTable)
              .set({ ...updateData, logoUrl: `/api/uploads/${filename}` })
              .where(eq(companiesTable.id, id)).returning({ id: companiesTable.id });
            if (!updated) throw new ImageProcessingError("company_not_found");
            return null;
          },
        );
        const [company] = await db.select().from(companiesTable)
          .where(eq(companiesTable.logoUrl, logoUrl));
        if (!company) throw new ImageProcessingError("image_reference_removed");
        res.json(company);
      } catch (error) {
        sendImageUploadError(res, error);
      }
      return;
    }
    sendImageUploadError(res, new ImageProcessingError("unsupported_format"));
    return;
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
  const id = parseCompanyId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "معرف الشركة غير صالح" });
    return;
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) {
    res.status(404).json({ error: "الشركة غير موجودة" });
    return;
  }

  if (req.user?.role === "project_manager" && company.createdById !== req.user.userId) {
    res.status(403).json({ error: "لا يمكنك حذف شركة لم تقم بإنشائها" });
    return;
  }

  let managedAssetId: string | null = null;
  if (company.logoUrl) {
    const filename = company.logoUrl.split("/").pop() ?? "";
    if (isLifecycleImageFilename(filename)) {
      const [asset] = await db.select().from(imageAssetsTable)
        .where(eq(imageAssetsTable.storageKey, `uploads/${filename}`));
      if (!asset) {
        res.status(500).json({ error: "بيانات الشعار غير مكتملة؛ لم يُحذف" });
        return;
      }
      if (asset.profile === "logo" && asset.projectId === null) {
        const [shared] = await db.select({ id: companiesTable.id }).from(companiesTable)
          .where(and(eq(companiesTable.logoUrl, company.logoUrl), ne(companiesTable.id, id))).limit(1);
        if (!shared) {
          if (!asset.storageBucket || !asset.storageKey) {
            res.status(500).json({ error: "تعذر التحقق من مخزن الشعار؛ لم يُحذف" });
            return;
          }
          for (const key of [asset.storageKey, asset.thumbnailKey, asset.printKey]) {
            if (key) await deleteImageObjectStrict(imageObjectName(key), asset.storageBucket);
          }
          await fsp.unlink(path.join(uploadsDir, filename)).catch(() => {});
          managedAssetId = asset.id;
        }
      } else {
        const filePath = path.join(uploadsDir, filename);
        await fsp.unlink(filePath).catch(() => {});
        await deleteFromCloud(filename);
        await deleteStoredReportImageVariants(filename, uploadsDir);
      }
    } else {
      const filePath = path.join(uploadsDir, filename);
      await fsp.unlink(filePath).catch(() => {});
      await deleteFromCloud(filename);
      await deleteStoredReportImageVariants(filename, uploadsDir);
    }
  }

  await db.transaction(async tx => {
    await tx.delete(companiesTable).where(eq(companiesTable.id, id));
    if (managedAssetId) await tx.delete(imageAssetsTable).where(eq(imageAssetsTable.id, managedAssetId!));
  });
  res.json({ success: true });
});

export default router;
