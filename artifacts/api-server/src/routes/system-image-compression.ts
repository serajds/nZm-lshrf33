import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq, isNotNull } from "drizzle-orm";
import {
  attendanceRecordsTable,
  companiesTable,
  db,
  projectFilesTable,
  reportsTable,
  usersTable,
  type SystemImageAssetKind,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import {
  createSystemImageCompressionJobStore,
  type CompressionAsset,
} from "../lib/system-image-compression-job-store";
import { imageCompressionFailureLabels } from "../lib/system-image-compression-labels";
import { listUploadedImageObjects } from "../lib/fileStorage";

const router: IRouter = Router();
const store = createSystemImageCompressionJobStore();
if (process.env.NODE_ENV === "development" && process.env.REPLIT_DEPLOYMENT !== "1") {
  void store.pauseForUnifiedPipeline().then(count => {
    if (count) console.info("Paused legacy system-image jobs", { jobsPaused: count });
  }).catch(() => console.warn("Could not pause legacy system-image jobs"));
}
const allowedKinds = new Set<SystemImageAssetKind>([
  "project_file",
  "report_photo",
  "attendance_selfie",
  "company_logo",
  "unreferenced_upload",
]);

// Check the current database role on every request. A still-valid JWT must
// not retain administrator access after a demotion.
router.use(requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }
    const [currentUser] = await db.select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (currentUser?.role !== "admin") {
      res.status(403).json({ error: "هذه الأداة متاحة لمدير النظام فقط" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

function storedFilename(value: string | null | undefined): string | null {
  if (!value) return null;
  let pathname: string;
  try {
    pathname = new URL(value, "https://internal.invalid").pathname;
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const match = pathname.match(/\/api\/uploads\/([^/]+)$/);
  if (!match) return null;
  const filename = match[1];
  return filename && !filename.includes("\\") && filename !== "." && filename !== ".."
    ? filename
    : null;
}

async function collectAssets(): Promise<CompressionAsset[]> {
  const byFilename = new Map<string, CompressionAsset>();
  const add = (
    filename: string | null,
    kind: SystemImageAssetKind,
    sourceBytes = 0,
    sourceMimeType: string | null = null,
  ) => {
    if (!filename || !allowedKinds.has(kind)) return;
    const current = byFilename.get(filename);
    if (current) {
      if (!current.assetKinds.includes(kind)) current.assetKinds.push(kind);
      current.sourceBytes = Math.max(current.sourceBytes, sourceBytes);
      current.sourceMimeType ??= sourceMimeType;
      return;
    }
    byFilename.set(filename, {
      filename,
      assetKinds: [kind],
      sourceBytes,
      sourceMimeType,
    });
  };

  const [files, reports, selfies, companies] = await Promise.all([
    db.select({
      filename: projectFilesTable.filename,
      fileSize: projectFilesTable.fileSize,
      mimeType: projectFilesTable.mimeType,
    }).from(projectFilesTable).where(eq(projectFilesTable.category, "image")),
    db.select({
      imageUrls: reportsTable.imageUrls,
      imageGroups: reportsTable.imageGroups,
    }).from(reportsTable),
    db.select({ filename: attendanceRecordsTable.selfieFilename })
      .from(attendanceRecordsTable)
      .where(isNotNull(attendanceRecordsTable.selfieFilename)),
    db.select({ logoUrl: companiesTable.logoUrl }).from(companiesTable)
      .where(isNotNull(companiesTable.logoUrl)),
  ]);
  for (const file of files) add(file.filename, "project_file", file.fileSize, file.mimeType);
  for (const report of reports) {
    const urls = new Set<string>(Array.isArray(report.imageUrls) ? report.imageUrls : []);
    const groups = Array.isArray(report.imageGroups) ? report.imageGroups : [];
    for (const group of groups) {
      const groupUrls = Array.isArray(group?.urls) ? group.urls : [];
      for (const url of groupUrls) if (typeof url === "string") urls.add(url);
    }
    for (const url of urls) add(storedFilename(url), "report_photo");
  }
  for (const selfie of selfies) add(selfie.filename, "attendance_selfie");
  for (const company of companies) add(storedFilename(company.logoUrl), "company_logo");
  const uploadedObjects = await listUploadedImageObjects();
  for (const file of uploadedObjects) {
    add(file.filename, "unreferenced_upload", file.size, file.contentType);
  }
  return [...byFilename.values()].sort((a, b) => a.filename.localeCompare(b.filename));
}

function summarize(assets: CompressionAsset[]) {
  const counts: Record<SystemImageAssetKind, number> = {
    project_file: 0,
    report_photo: 0,
    attendance_selfie: 0,
    company_logo: 0,
    unreferenced_upload: 0,
  };
  let knownBytes = 0;
  for (const asset of assets) {
    for (const kind of asset.assetKinds) counts[kind]++;
    knownBytes += asset.sourceBytes;
  }
  return {
    uniqueFiles: assets.length,
    counts,
    knownBytes,
    note: "الإجمالي ملفات فريدة، وقد يظهر الملف في أكثر من فئة. يشمل صور الرفع الأصلية المرتبطة أو المخزنة، ويستثني نسخ المعاينة والطباعة المشتقة.",
  };
}

function presentJob(job: Awaited<ReturnType<typeof store.getLatest>>) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    compressed: job.compressed,
    skipped: job.skipped,
    failed: job.failed,
    currentFilename: job.currentFilename,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    exceptions: job.exceptions.map((item) => ({
      filename: item.filename,
      status: item.status,
      message: imageCompressionFailureLabels[item.errorCode ?? ""] ?? "تم تجاوز الصورة دون تغيير الأصل",
      sourceBytes: item.sourceBytes,
      outputBytes: item.outputBytes,
    })),
  };
}

router.get("/admin/system-image-compression/preflight", async (_req, res) => {
  try {
    res.json({ ...summarize(await collectAssets()), job: presentJob(await store.getLatest()) });
  } catch {
    res.status(500).json({ error: "تعذر فحص الصور المرتبطة بالنظام" });
  }
});

router.get("/admin/system-image-compression", async (_req, res) => {
  try {
    res.json({ job: presentJob(await store.getLatest()) });
  } catch {
    res.status(500).json({ error: "تعذر تحميل حالة ضغط الصور" });
  }
});

const retiredWorker = (_req: Request, res: Response) => {
  res.status(410).json({
    error: "توقفت أداة الضغط القديمة لأنها تستبدل الأصول خارج السياسة الموحدة. لم تُحذف بيانات المهام.",
  });
};
router.post("/admin/system-image-compression/start", retiredWorker);
router.post("/admin/system-image-compression/pause", retiredWorker);
router.post("/admin/system-image-compression/resume", retiredWorker);

export default router;
