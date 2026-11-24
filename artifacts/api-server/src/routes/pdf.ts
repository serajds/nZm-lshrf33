import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, reportsTable, activitiesTable, projectExtensionsTable, projectSuspensionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireProjectAccess } from "../middlewares/auth";
import { requireTabView } from "../middlewares/tab-access";
import { calcPlannedProgressForProject, calcActualProgressForProject, calcDelayDays, calcActivityPlannedProgress, calcSPI, hasValidProjectSchedule, isActivityDelayed, roundPercent, utcDay, utcDayDifference } from "../lib/progress";
import { resolveLinkedActivityProgress } from "../lib/external-sources";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { streamFromCloud } from "../lib/fileStorage";
import { pipeline } from "stream/promises";
import { randomUUID } from "node:crypto";
import { resolveStoredImageForRead } from "../lib/image-read-reference";
import { streamStoredImage } from "../lib/image-object-stream";
import { mapWithConcurrency } from "../lib/report-preview-assets";
import { validateReportPdfImage } from "../lib/report-pdf-image-validation";
import { logger } from "../lib/logger";

async function resolveImagePath(imgUrl: string, uploadsDir: string, projectId: number): Promise<{ path: string; managed: boolean } | null> {
  const filename = path.basename(imgUrl.split("?")[0]);
  const managed = await resolveStoredImageForRead(filename, "print", projectId);
  if (managed.kind !== "legacy") {
    if (managed.kind !== "ready") throw new Error("Report image unavailable");
    const destination = path.join(uploadsDir, managed.filename);
    if (fs.existsSync(destination)) return { path: destination, managed: true };
    const temporary = path.join(uploadsDir, `.pdf-image-${randomUUID()}.tmp`);
    try {
      const cloud = await streamStoredImage(managed.filename, managed.bucketId);
      await pipeline(cloud.stream, fs.createWriteStream(temporary, { flags: "wx" }));
      await fs.promises.rename(temporary, destination);
      return { path: destination, managed: true };
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
  const localPath = path.join(uploadsDir, filename);
  if (fs.existsSync(localPath)) return { path: localPath, managed: false };

  const cloudResult = await streamFromCloud(filename);
  if (!cloudResult) return null;

  const tmpPath = path.join(uploadsDir, filename);
  const ws = fs.createWriteStream(tmpPath);
  await pipeline(cloudResult.stream as NodeJS.ReadableStream, ws);
  return { path: tmpPath, managed: false };
}

type PdfImageGroup = { category: string; urls: string[] };
class ReportPdfImageError extends Error {
  constructor(readonly reportId: number, readonly imageIndex: number) { super("report_pdf_image_unavailable"); }
}
function reportImageGroups(report: { imageGroups?: unknown; imageUrls?: string[] | null }): PdfImageGroup[] {
  if (Array.isArray(report.imageGroups)) {
    const groups = report.imageGroups.flatMap((value): PdfImageGroup[] => {
      if (!value || typeof value !== "object") return [];
      const group = value as { category?: unknown; urls?: unknown };
      if (!Array.isArray(group.urls)) return [];
      return [{
        category: typeof group.category === "string" ? group.category : "صور التقرير",
        urls: group.urls.map(url => typeof url === "string" ? url : ""),
      }];
    });
    if (groups.length) return groups;
  }
  return report.imageUrls?.length ? [{ category: "صور الموقع", urls: report.imageUrls }] : [];
}

const AMIRI_FONT = path.join(process.cwd(), "src/fonts/Amiri-Regular.ttf");
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;
const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));

// ─────────────────────────────────────────────
// Color palette
// ─────────────────────────────────────────────
const C = {
  primary:   "#1e3a5f",
  accent:    "#3b82f6",
  success:   "#059669",
  warning:   "#f59e0b",
  danger:    "#dc2626",
  light:     "#f1f5f9",
  border:    "#cbd5e1",
  textDark:  "#1e293b",
  textMuted: "#64748b",
  white:     "#ffffff",
};

const router: IRouter = Router();

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function statusLabel(s: string) {
  return { not_started: "لم يبدأ", in_progress: "قيد التنفيذ", completed: "مكتمل", delayed: "متأخر" }[s] ?? s;
}

function statusColor(s: string) {
  return { not_started: C.textMuted, in_progress: C.accent, completed: C.success, delayed: C.danger }[s] ?? C.textMuted;
}

function reportTypeLabel(t: string) {
  return t === "weekly" ? "أسبوعي" : "شهري";
}

function drawProgressBar(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, h: number, pct: number, color: string, bg = "#e2e8f0") {
  doc.roundedRect(x, y, w, h, h / 2).fill(bg);
  if (pct > 0) {
    const filled = Math.max(h, (pct / 100) * w);
    doc.roundedRect(x, y, filled, h, h / 2).fill(color);
  }
}

function drawSectionHeader(doc: InstanceType<typeof PDFDocument>, title: string, y: number) {
  doc.rect(MARGIN, y, CONTENT_W, 22).fill(C.primary);
  doc.fillColor(C.white).fontSize(11).text(title, MARGIN + 8, y + 5, { width: CONTENT_W - 16, align: "right" });
  doc.fillColor(C.textDark);
  return y + 30;
}

function ensurePage(doc: InstanceType<typeof PDFDocument>, neededHeight: number): number {
  if (doc.y + neededHeight > PAGE_H - 60) {
    doc.addPage();
    return MARGIN;
  }
  return doc.y;
}

type ReportSnapshotRow = {
  name?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  plannedProgress?: number;
  actualProgress?: number;
  externalSourceGroupId?: number | null;
  actualRecordedAt?: string;
  plannedAsOfDate?: string;
  plannedHistoricalUnverified?: boolean;
  actualHistoricalUnverified?: boolean;
  actualAsOfDate?: string;
  weight?: number;
  status?: string;
};

function snapshotProgress(rows: ReportSnapshotRow[], field: "plannedProgress" | "actualProgress"): number {
  let totalWeight = 0;
  let weightedProgress = 0;
  for (const row of rows) {
    const weight = typeof row.weight === "number" && row.weight > 0 ? row.weight : 1;
    const value = typeof row[field] === "number" && Number.isFinite(row[field]) ? row[field]! : 0;
    totalWeight += weight;
    weightedProgress += value * weight;
  }
  return totalWeight > 0 ? weightedProgress / totalWeight : 0;
}

function snapshotActualIsHistoricallyUnverified(
  reportDate: string | Date,
  createdAt: string | Date | null | undefined,
  rows: ReportSnapshotRow[],
): boolean {
  const reportDay = utcDay(reportDate).getTime();
  if (!Number.isFinite(reportDay)) return true;
  if (rows.length === 0) return false;
  return rows.some(row => {
    if (typeof row.actualProgress !== "number" || !Number.isFinite(row.actualProgress)) return true;
    const recordedAt = row.actualRecordedAt ?? createdAt;
    if (!recordedAt) return true;
    const recordedDay = utcDay(recordedAt).getTime();
    return !Number.isFinite(recordedDay) || reportDay < recordedDay;
  });
}

// ─────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────
  router.get("/projects/:projectId/reports/export-pdf", requireProjectAccess("projectId"), requireTabView("reports"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const requestedReportId = typeof req.query.reportId === "string" ? Number(req.query.reportId) : null;

  if (requestedReportId !== null && (!Number.isSafeInteger(requestedReportId) || requestedReportId <= 0)) {
    res.status(400).json({ error: "رقم التقرير غير صالح" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const reportConditions = [eq(reportsTable.projectId, projectId), eq(reportsTable.status, "approved")];
  if (requestedReportId !== null) {
    reportConditions.push(eq(reportsTable.id, requestedReportId));
  }
  const reports = await db.select().from(reportsTable)
    .where(and(...reportConditions))
    .orderBy(reportsTable.reportDate);

  if (requestedReportId !== null && reports.length === 0) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const activityRows = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder);
  const currentAsOf = new Date();
  const activities = await resolveLinkedActivityProgress(activityRows, currentAsOf);

  const extensions = await db.select().from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(projectExtensionsTable.extensionDate);

  const suspensions = await db.select().from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, projectId))
    .orderBy(projectSuspensionsTable.startDate);

  // Resolve and validate every image before sending PDF headers. Missing or
  // corrupt inputs must fail the export, never silently produce a partial PDF.
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const imagePathsByReport = new Map<number, Array<{ category: string; paths: string[] }>>();
  const imagePreflightStarted = performance.now();
  let imageCount = 0, imageBytes = 0, managedImageCount = 0, legacyImageCount = 0;
  let pixelValidationCount = 0, pixelValidationMs = 0, metadataValidationMs = 0;
  try {
    for (const report of reports) {
      let imageIndex = 0;
      const groups = await mapWithConcurrency(reportImageGroups(report), 1, async group => ({
        category: group.category,
        paths: await mapWithConcurrency(group.urls, 1, async url => {
          const index = imageIndex++;
          try {
            const resolved = await resolveImagePath(url, uploadsDir, projectId);
            if (!resolved) throw new Error("missing");
            const stat = await fs.promises.stat(resolved.path);
            if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("size");
            const fingerprint = [
              stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs,
            ].join(":");
            const validation = await validateReportPdfImage(
              resolved.path, resolved.managed, undefined, fingerprint,
            );
            metadataValidationMs += validation.metadataMs;
            pixelValidationMs += validation.pixelValidationMs;
            if (validation.pixelValidated) {
              pixelValidationCount++;
              legacyImageCount++;
            } else {
              managedImageCount++;
            }
            imageCount++;
            imageBytes += stat.size;
            return resolved.path;
          } catch {
            throw new ReportPdfImageError(report.id, index);
          }
        }),
      }));
      imagePathsByReport.set(report.id, groups);
    }
    logger.info({
      projectId, imageCount, imageBytes,
      managedImageCount, legacyImageCount, pixelValidationCount,
      pixelValidationMs: Number(pixelValidationMs.toFixed(1)),
      metadataValidationMs: Number(metadataValidationMs.toFixed(1)),
      preflightMs: Number((performance.now() - imagePreflightStarted).toFixed(1)),
    }, "PDF image preflight complete");
  } catch (error) {
    if (error instanceof ReportPdfImageError) {
      logger.warn({
        projectId, reportId: error.reportId, imageIndex: error.imageIndex,
      }, "PDF export stopped before returning an incomplete image set");
      res.status(503).json({
        error: "تعذّر تجهيز إحدى صور التقرير. لم يُنشأ ملف PDF؛ أعد المحاولة بعد إصلاح الصورة.",
        code: "report_pdf_image_unavailable",
        reportId: error.reportId,
        imageIndex: error.imageIndex,
      });
      return;
    }
    throw error;
  }

  const hasFont = fs.existsSync(AMIRI_FONT);
  const periodOnly = project.reportDisplayMode === "period_only";

  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    info: {
      Title: `تقرير المشروع الشامل - ${project.name}`,
      Author: "إدارة الإشراف والمتابعة",
    },
    // A single report may contain hundreds of photos. Stream those pages as
    // they are produced instead of retaining the whole document in memory.
    bufferPages: requestedReportId === null,
  });

  if (hasFont) { doc.registerFont("Amiri", AMIRI_FONT); doc.font("Amiri"); }
  const setFont = (size: number, color = C.textDark) => {
    if (hasFont) doc.font("Amiri");
    doc.fontSize(size).fillColor(color);
  };

  res.setHeader("Content-Type", "application/pdf");
  const downloadName = requestedReportId === null
    ? `project-${projectId}-reports.pdf`
    : periodOnly
      ? `report-period-${reports[0].periodStart || "start"}-${reports[0].periodEnd || "end"}.pdf`
      : `report-${reports[0].reportNumber || requestedReportId}.pdf`;
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${downloadName}`);
  doc.pipe(res);

  // ════════════════════════════════════════════
  // PAGE 1: COVER
  // ════════════════════════════════════════════

  // Top header band
  doc.rect(0, 0, PAGE_W, 90).fill(C.primary);
  setFont(9, C.white);
  doc.text("إدارة الإشراف والمتابعة", MARGIN, 18, { width: CONTENT_W, align: "center" });
  setFont(18, C.white);
  doc.text("تقرير المشروع الشامل", MARGIN, 38, { width: CONTENT_W, align: "center" });
  setFont(9, "#93c5fd");
  doc.text(`تاريخ الإصدار: ${formatDate(new Date())}`, MARGIN, 70, { width: CONTENT_W, align: "center" });

  let y = 105;

  // Project name box
  doc.roundedRect(MARGIN, y, CONTENT_W, 40, 6).fill(C.light);
  setFont(14, C.primary);
  doc.text(project.name, MARGIN + 10, y + 10, { width: CONTENT_W - 20, align: "center" });
  y += 52;

  const hasSchedule = project.noSchedule !== true
    && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  const isNoSchedule = !hasSchedule;

  const infoItems: [string, string | null][] = [
    ["الجهة المالكة", project.ownerEntity],
    ["المقاول المنفذ", project.contractor],
    ["الجهة المشرفة", project.supervisorEntity],
    ["موقع المشروع", project.location],
    ...(hasSchedule ? [["تاريخ البداية", formatDate(project.startDate)] as [string, string]] : []),
    ...(hasSchedule ? [["التاريخ المتوقع للإنهاء", formatDate(project.expectedEndDate)] as [string, string]] : []),
    ...(!hasSchedule ? [["حالة الجدول الزمني", project.noSchedule === true ? "بدون جدول زمني معتمد" : "الجدول الزمني غير مكتمل أو غير صالح"] as [string, string]] : []),
  ];

  const colW = (CONTENT_W - 8) / 2;
  doc.rect(MARGIN, y, CONTENT_W, infoItems.length / 2 * 26 + 8).fill(C.white).stroke(C.border);

  infoItems.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ix = col === 0 ? MARGIN + colW + 8 : MARGIN + 4;
    const iy = y + 8 + row * 26;

    if (col === 0 && i > 0) {
      doc.moveTo(MARGIN + colW + 4, iy - 4).lineTo(MARGIN + CONTENT_W - 4, iy - 4).stroke(C.border);
    }

    setFont(8, C.textMuted);
    doc.text(item[0], ix, iy, { width: colW - 8, align: "right" });
    setFont(9, C.textDark);
    doc.text(item[1] ?? "—", ix, iy + 10, { width: colW - 8, align: "right" });
  });

  y += infoItems.length / 2 * 26 + 20;

  const overall = activities.length > 0
    ? roundPercent(calcActualProgressForProject(activities))
    : roundPercent(project.overallProgress ?? 0);

  if (isNoSchedule) {
    doc.rect(MARGIN, y, CONTENT_W, 60).fill(C.light).stroke(C.border);
    setFont(10, C.primary);
    doc.text("ملخص الأداء", MARGIN + 8, y + 8, { width: CONTENT_W - 16, align: "right" });

    const barY1 = y + 26;
    setFont(8, C.textMuted);
    doc.text("الإنجاز الفعلي", MARGIN + 8, barY1, { width: 90, align: "right" });
    drawProgressBar(doc, MARGIN + 105, barY1, CONTENT_W - 185, 12, overall, C.accent);
    setFont(9, C.textDark);
    doc.text(`${overall}%`, MARGIN + CONTENT_W - 75, barY1 - 1, { width: 70, align: "right" });

    setFont(8, C.textMuted);
    doc.text(
      project.noSchedule === true
        ? "مشروع بدون جدول زمني معتمد — لا يُحسب المخطط أو التأخير"
        : "الجدول الزمني غير مكتمل أو غير صالح — لا يُحسب المخطط أو التأخير",
      MARGIN + 8,
      y + 44,
      { width: CONTENT_W - 16, align: "right" },
    );

    y += 70;
  } else {
    const today = currentAsOf;
    const totalDays = Math.max(1, utcDayDifference(project.expectedEndDate!, project.startDate!));
    const elapsed = Math.max(0, utcDayDifference(today, project.startDate!));
    const planned = roundPercent(calcPlannedProgressForProject(activities, elapsed, totalDays));
    const deviation = roundPercent(overall - planned);
    const delayDays = calcDelayDays(planned, overall, totalDays);

    doc.rect(MARGIN, y, CONTENT_W, 90).fill(C.light).stroke(C.border);
    setFont(10, C.primary);
    doc.text("ملخص الأداء", MARGIN + 8, y + 8, { width: CONTENT_W - 16, align: "right" });

    const barY1 = y + 26;
    setFont(8, C.textMuted);
    doc.text("الإنجاز الفعلي", MARGIN + 8, barY1, { width: 90, align: "right" });
    drawProgressBar(doc, MARGIN + 105, barY1, CONTENT_W - 185, 12, overall, C.accent);
    setFont(9, C.textDark);
    doc.text(`${overall}%`, MARGIN + CONTENT_W - 75, barY1 - 1, { width: 70, align: "right" });

    const barY2 = y + 46;
    setFont(8, C.textMuted);
    doc.text("الإنجاز المخطط", MARGIN + 8, barY2, { width: 90, align: "right" });
    drawProgressBar(doc, MARGIN + 105, barY2, CONTENT_W - 185, 12, planned, "#94a3b8");
    setFont(9, C.textDark);
    doc.text(`${planned}%`, MARGIN + CONTENT_W - 75, barY2 - 1, { width: 70, align: "right" });

    const st1x = MARGIN + 8;
    setFont(8, C.textMuted);
    doc.text(`الانحراف: `, st1x + 200, y + 68, { continued: true, width: 60 });
    const devColor = deviation < -10 ? C.danger : deviation < 0 ? C.warning : C.success;
    setFont(9, devColor);
    doc.text(`${deviation > 0 ? "+" : ""}${deviation}%`);

    setFont(8, C.textMuted);
    doc.text(`الأيام المنقضية: `, st1x + 90, y + 68, { continued: true, width: 85 });
    setFont(9, C.textDark);
    doc.text(`${elapsed} / ${totalDays} يوم`);

    if (delayDays > 0) {
      setFont(8, C.textMuted);
      doc.text(`التأخر التقديري: `, st1x, y + 68, { continued: true, width: 85 });
      setFont(9, C.danger);
      doc.text(`${delayDays} يوم`);
    }

    y += 100;
  }

  // Stats row (activities/reports)
  const statItems = [
    { label: "إجمالي البنود", value: String(activities.length) },
    { label: "مكتملة", value: String(activities.filter(a => a.status === "completed").length), color: C.success },
    { label: "قيد التنفيذ", value: String(activities.filter(a => a.status === "in_progress").length), color: C.accent },
    { label: "متأخرة", value: String(activities.filter(a => isActivityDelayed(a, new Date(), isNoSchedule)).length), color: C.danger },
    { label: "التقارير", value: String(reports.length) },
  ];
  const statW = CONTENT_W / statItems.length;
  statItems.forEach((st, i) => {
    const sx = MARGIN + i * statW;
    doc.rect(sx, y, statW, 45).fill(i % 2 === 0 ? C.white : C.light).stroke(C.border);
    setFont(16, st.color ?? C.primary);
    doc.text(st.value, sx + 4, y + 6, { width: statW - 8, align: "center" });
    setFont(7, C.textMuted);
    doc.text(st.label, sx + 4, y + 28, { width: statW - 8, align: "center" });
  });
  y += 55;

  // ════════════════════════════════════════════
  // PAGE 2: ACTIVITIES TABLE
  // ════════════════════════════════════════════
  if (activities.length > 0) {
    doc.addPage();
    if (hasFont) doc.font("Amiri");
    y = MARGIN;
    y = drawSectionHeader(doc, "بيانات المشروع الحالية — جدول بنود الأعمال والإنجاز", y);

    const today = new Date();

    const cols = isNoSchedule
      ? { name: 250, actual: 70, status: 100, period: 90, planned: 0, dev: 0 }
      : { name: 200, planned: 55, actual: 55, dev: 45, status: 70, period: 85 };
    const headerH = 20;
    doc.rect(MARGIN, y, CONTENT_W, headerH).fill(C.light).stroke(C.border);

    const heads = isNoSchedule
      ? [
          { text: "الفترة الزمنية", x: MARGIN + 4, w: cols.period },
          { text: "الحالة", x: MARGIN + cols.period + 4, w: cols.status },
          { text: "فعلي%", x: MARGIN + cols.period + cols.status + 4, w: cols.actual },
          { text: "اسم البند", x: MARGIN + cols.period + cols.status + cols.actual + 4, w: cols.name },
        ]
      : [
          { text: "الفترة الزمنية", x: MARGIN + 4, w: cols.period },
          { text: "الحالة", x: MARGIN + cols.period + 4, w: cols.status },
          { text: "الانحراف", x: MARGIN + cols.period + cols.status + 4, w: cols.dev },
          { text: "فعلي%", x: MARGIN + cols.period + cols.status + cols.dev + 4, w: cols.actual },
          { text: "مخطط%", x: MARGIN + cols.period + cols.status + cols.dev + cols.actual + 4, w: cols.planned },
          { text: "اسم البند", x: MARGIN + cols.period + cols.status + cols.dev + cols.actual + cols.planned + 4, w: cols.name },
        ];
    heads.forEach(h => {
      setFont(8, C.textMuted);
      doc.text(h.text, h.x, y + 5, { width: h.w, align: "right" });
    });
    y += headerH;

    for (const [i, a] of activities.entries()) {
      const rowH = 32;
      y = ensurePage(doc, rowH + 10);
      const bg = i % 2 === 0 ? C.white : "#f8fafc";
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(bg).stroke(C.border);

      if (isNoSchedule) {
        setFont(9, C.textDark);
        const nameX = MARGIN + cols.period + cols.status + cols.actual + 4;
        doc.text(a.name, nameX, y + 4, { width: cols.name - 8, align: "right" });

        const acX = MARGIN + cols.period + cols.status + 4;
        setFont(9, C.textDark);
        doc.text(`${a.actualProgress}%`, acX, y + 4, { width: cols.actual - 8, align: "center" });
        drawProgressBar(doc, acX + 2, y + 18, cols.actual - 12, 5, a.actualProgress, statusColor(a.status));

        const stX = MARGIN + cols.period + 4;
        setFont(8, statusColor(a.status));
        doc.text(statusLabel(a.status), stX, y + 10, { width: cols.status - 8, align: "center" });

        setFont(7, C.textMuted);
        doc.text(formatDate(a.plannedStartDate), MARGIN + 4, y + 5, { width: cols.period - 8, align: "right" });
        doc.text(`→ ${formatDate(a.plannedEndDate)}`, MARGIN + 4, y + 17, { width: cols.period - 8, align: "right" });
      } else {
        setFont(9, C.textDark);
        const nameX = MARGIN + cols.period + cols.status + cols.dev + cols.actual + cols.planned + 4;
        doc.text(a.name, nameX, y + 4, { width: cols.name - 8, align: "right" });

        const actPlanned = roundPercent(calcActivityPlannedProgress(a, today));
        const actActual = roundPercent(a.actualProgress);
        const plX = MARGIN + cols.period + cols.status + cols.dev + cols.actual + 4;
        setFont(9, C.textMuted);
        doc.text(`${actPlanned}%`, plX, y + 10, { width: cols.planned - 8, align: "center" });

        const acX = MARGIN + cols.period + cols.status + cols.dev + 4;
        setFont(9, C.textDark);
        doc.text(`${actActual}%`, acX, y + 4, { width: cols.actual - 8, align: "center" });
        drawProgressBar(doc, acX + 2, y + 18, cols.actual - 12, 5, actActual, statusColor(a.status));

        const devN = roundPercent(actActual - actPlanned);
        const dvX = MARGIN + cols.period + cols.status + 4;
        setFont(8, devN < 0 ? C.danger : devN > 0 ? C.success : C.textMuted);
        doc.text(`${devN > 0 ? "+" : ""}${devN}%`, dvX, y + 10, { width: cols.dev - 8, align: "center" });

        const stX = MARGIN + cols.period + 4;
        setFont(8, statusColor(a.status));
        doc.text(statusLabel(a.status), stX, y + 10, { width: cols.status - 8, align: "center" });

        setFont(7, C.textMuted);
        doc.text(formatDate(a.plannedStartDate), MARGIN + 4, y + 5, { width: cols.period - 8, align: "right" });
        doc.text(`→ ${formatDate(a.plannedEndDate)}`, MARGIN + 4, y + 17, { width: cols.period - 8, align: "right" });
      }

      y += rowH;
      if ((i + 1) % 16 === 0) await yieldToEventLoop();
    }

    // Legend
    y = ensurePage(doc, 30);
    y += 8;
    setFont(8, C.textMuted);
    doc.text("البنود المكتملة بلون أخضر — المتأخرة بلون أحمر — قيد التنفيذ بلون أزرق", MARGIN, y, { width: CONTENT_W, align: "right" });
  }

  // ════════════════════════════════════════════
  // PAGES 3+: REPORTS
  // ════════════════════════════════════════════
  if (reports.length === 0) {
    doc.addPage();
    if (hasFont) doc.font("Amiri");
    setFont(12, C.textMuted);
    doc.text("لا توجد تقارير دورية مسجلة لهذا المشروع.", MARGIN, PAGE_H / 2, { width: CONTENT_W, align: "center" });
  } else {
    for (let idx = 0; idx < reports.length; idx++) {
      const storedReport = reports[idx];
      const report = storedReport;
      const actualUnavailable = report.progressPercentage == null;
      doc.addPage();
      if (hasFont) doc.font("Amiri");
      y = MARGIN;

      if (actualUnavailable) {
        doc.roundedRect(MARGIN, y, CONTENT_W, 30, 4).fill("#fff7ed").stroke(C.warning);
        setFont(8, "#9a3412");
        doc.text(
          "أصبح هذا تقريراً عادياً غير معتمد، لكن لا يتوفر سجل إنجاز موثوق لهذا التاريخ. أدخل النسبة الفعلية الموثقة قبل اعتماده.",
          MARGIN + 8,
          y + 7,
          { width: CONTENT_W - 16, align: "right" },
        );
        y += 38;
      }

      // Report header
      const typeColor = report.type === "monthly" ? C.primary : C.accent;
      doc.rect(MARGIN, y, CONTENT_W, 50).fill(typeColor);
      setFont(9, C.white);
      doc.text(
        periodOnly
          ? `الفترة: ${formatDate(report.periodStart)} — ${formatDate(report.periodEnd)}`
          : `تقرير ${reportTypeLabel(report.type)} #${report.reportNumber}  —  ${idx + 1} من ${reports.length}`,
        MARGIN + 8,
        y + 8,
        { width: CONTENT_W - 16, align: "right" },
      );
      setFont(12, C.white);
      doc.text(
        periodOnly
          ? `تاريخ التقرير: ${formatDate(report.reportDate)}`
          : `الفترة: ${formatDate(report.periodStart)} — ${formatDate(report.periodEnd)}`,
        MARGIN + 8,
        y + 24,
        { width: CONTENT_W - 16, align: "right" },
      );
      if (!periodOnly) {
        setFont(8, "rgba(255,255,255,0.8)");
        doc.text(`تاريخ التقرير: ${formatDate(report.reportDate)}`, MARGIN + 8, y + 40, { width: CONTENT_W - 16, align: "right" });
      }
      y += 58;

      // Progress indicator for this report
      doc.roundedRect(MARGIN, y, CONTENT_W, 32, 4).fill(C.light).stroke(C.border);
      setFont(8, C.textMuted);
      doc.text(
        actualUnavailable ? "الإنجاز الفعلي غير متاح" : "نسبة الإنجاز المُبلَّغ عنها في هذه الفترة",
        MARGIN + 8, y + 6, { width: CONTENT_W - 100, align: "right" },
      );
      const storedForecastPlan = Array.isArray(report.activitiesSnapshot)
        && report.activitiesSnapshot.length > 0
        && (report.activitiesSnapshot as ReportSnapshotRow[]).every(row =>
          typeof row.plannedProgress === "number" && row.plannedHistoricalUnverified !== true)
        ? snapshotProgress(report.activitiesSnapshot as ReportSnapshotRow[], "plannedProgress")
        : null;
      const reportProgressValue = actualUnavailable ? null : report.progressPercentage;
      const displayedReportedProgress = reportProgressValue == null ? null : roundPercent(reportProgressValue);
      drawProgressBar(doc, MARGIN + 8, y + 20, CONTENT_W - 100, 8, displayedReportedProgress ?? 0, typeColor);
      setFont(14, typeColor);
      doc.text(displayedReportedProgress == null ? "—" : `${displayedReportedProgress}%`, MARGIN + CONTENT_W - 88, y + 8, { width: 80, align: "center" });
      y += 42;

      const reportSnapshot = Array.isArray(report.activitiesSnapshot)
        ? report.activitiesSnapshot as ReportSnapshotRow[]
        : [];
      if (!Array.isArray(report.activitiesSnapshot)) {
        y = ensurePage(doc, 34);
        doc.roundedRect(MARGIN, y, CONTENT_W, 28, 4).fill("#fff7ed").stroke(C.warning);
        setFont(9, "#9a3412");
        doc.text(
          "بيانات التقدم التاريخية غير متاحة لهذا التقرير القديم (لا توجد لقطة أنشطة محفوظة). لا تمثل بيانات المشروع الحالية حالة التقرير السابقة.",
          MARGIN + 8,
          y + 7,
          { width: CONTENT_W - 16, align: "right" },
        );
        y += 36;
      } else {
        const rawHistoricalPlanned = snapshotProgress(reportSnapshot, "plannedProgress");
        const rawHistoricalActual = snapshotProgress(reportSnapshot, "actualProgress");
        const plannedUnverified = reportSnapshot.some(row => row.plannedHistoricalUnverified === true);
        const actualUnverified = actualUnavailable
          || snapshotActualIsHistoricallyUnverified(report.reportDate, report.createdAt, reportSnapshot);
        const plannedUnavailable = !hasSchedule || plannedUnverified;
        const historicalSpi = actualUnverified || plannedUnavailable
          ? null
          : calcSPI(rawHistoricalPlanned, rawHistoricalActual);
        const displayedPlanned = roundPercent(rawHistoricalPlanned);
        const displayedActual = actualUnavailable ? null : roundPercent(rawHistoricalActual);
        y = ensurePage(doc, 45);
        y = drawSectionHeader(doc, `لقطة الأنشطة المحفوظة للتقرير (${formatDate(report.reportDate)})`, y);
        setFont(9, C.textDark);
        doc.text(
          `${!hasSchedule ? "المخطط الموزون: غير متاح (لا يوجد جدول صالح)" : plannedUnverified ? "المخطط الموزون: غير موثق لتاريخ التقرير" : `المخطط الموزون: ${displayedPlanned}%`}    الفعلي المسجل عند الإنشاء: ${displayedActual == null ? "غير متاح" : `${displayedActual}%`}    SPI: ${historicalSpi == null ? (!hasSchedule ? "غير متاح" : actualUnverified || plannedUnverified ? "غير موثق تاريخياً" : "غير متاح (المخطط صفر)") : historicalSpi}`,
          MARGIN + 4,
          y,
          { width: CONTENT_W - 8, align: "right" },
        );
        y += 18;
        if (actualUnverified) {
          y = ensurePage(doc, 30);
          doc.roundedRect(MARGIN, y, CONTENT_W, 24, 4).fill("#fff7ed").stroke(C.warning);
          setFont(8, "#9a3412");
          doc.text(
            "القيم الفعلية أدناه مسجلة وقت إنشاء التقرير، ولا يمكن توثيقها كإنجاز فعلي في تاريخ تقرير أسبق.",
            MARGIN + 8,
            y + 6,
            { width: CONTENT_W - 16, align: "right" },
          );
          y += 30;
        }
        if (plannedUnverified && hasSchedule) {
          y = ensurePage(doc, 30);
          doc.roundedRect(MARGIN, y, CONTENT_W, 24, 4).fill("#fff7ed").stroke(C.warning);
          setFont(8, "#9a3412");
          doc.text(
            "تغيّر تاريخ التقرير بعد حفظ خطة بند مرتبط؛ الخطة المحفوظة تخص التاريخ الأصلي ولا يمكن إعادة بنائها تاريخياً.",
            MARGIN + 8,
            y + 6,
            { width: CONTENT_W - 16, align: "right" },
          );
          y += 30;
        }
        for (const [activityIndex, activity] of reportSnapshot.entries()) {
          y = ensurePage(doc, 18);
          const actual = roundPercent(typeof activity.actualProgress === "number" ? activity.actualProgress : 0);
          const planned = roundPercent(typeof activity.plannedProgress === "number" ? activity.plannedProgress : 0);
          const plannedText = !hasSchedule
            ? "غير متاح"
            : plannedUnverified && activity.plannedHistoricalUnverified
              ? `${planned}% (الخطة المحفوظة بتاريخ ${formatDate(activity.plannedAsOfDate)})`
              : `${planned}%`;
          setFont(8, C.textDark);
          doc.text(
            actualUnavailable
                ? `${activity.name ?? "بند"} — مخطط ${plannedText}، فعلي غير متاح، الحالة غير متاحة`
                : `${activity.name ?? "بند"} — مخطط ${plannedText}، فعلي ${actual}%، الحالة: ${statusLabel(activity.status ?? "not_started")}`,
            MARGIN + 6,
            y,
            { width: CONTENT_W - 12, align: "right" },
          );
          y += 14;
          if ((activityIndex + 1) % 16 === 0) await yieldToEventLoop();
        }
        y += 4;
      }

      // Work description
      if (report.workDescription) {
        y = ensurePage(doc, 40);
        y = drawSectionHeader(doc, "الأعمال المنجزة خلال الفترة", y);
        doc.roundedRect(MARGIN, y, CONTENT_W, 14).fill(C.light);
        setFont(9, C.textDark);
        const descLines = report.workDescription.split("\n");
        descLines.forEach(line => {
          y = ensurePage(doc, 16);
          if (line.trim().startsWith("-") || line.trim().startsWith("•")) {
            doc.circle(MARGIN + CONTENT_W - 10, y + 5, 2).fill(C.accent);
            doc.text(line.replace(/^[-•]\s*/, ""), MARGIN + 8, y + 1, { width: CONTENT_W - 20, align: "right" });
          } else if (line.trim()) {
            doc.text(line.trim(), MARGIN + 8, y + 1, { width: CONTENT_W - 16, align: "right" });
          }
          y += 14;
        });
        y += 4;
      }

      // Technical notes
      if (report.technicalNotes) {
        y = ensurePage(doc, 40);
        doc.rect(MARGIN, y, CONTENT_W, 20).fill(C.warning + "22").stroke(C.warning + "55");
        setFont(9, "#92400e");
        doc.text("ملاحظات فنية", MARGIN + 8, y + 5, { width: CONTENT_W - 16, align: "right" });
        y += 22;
        setFont(9, C.textDark);
        const noteLines = report.technicalNotes.split("\n");
        noteLines.forEach(line => {
          if (!line.trim()) return;
          y = ensurePage(doc, 16);
          doc.text(line.trim(), MARGIN + 8, y, { width: CONTENT_W - 16, align: "right" });
          y += 14;
        });
        y += 4;
      }

      // Recommendations
      if (report.recommendations) {
        y = ensurePage(doc, 40);
        doc.rect(MARGIN, y, CONTENT_W, 20).fill(C.success + "22").stroke(C.success + "55");
        setFont(9, "#065f46");
        doc.text("التوصيات", MARGIN + 8, y + 5, { width: CONTENT_W - 16, align: "right" });
        y += 22;
        setFont(9, C.textDark);
        const recLines = report.recommendations.split("\n");
        let recNum = 1;
        recLines.forEach(line => {
          if (!line.trim()) return;
          y = ensurePage(doc, 16);
          const isNumbered = /^\d+\./.test(line.trim());
          if (!isNumbered && (line.trim().startsWith("-") || line.trim().startsWith("•"))) {
            doc.text(`${recNum++}. ${line.replace(/^[-•]\s*/, "")}`, MARGIN + 8, y, { width: CONTENT_W - 16, align: "right" });
          } else {
            doc.text(line.trim(), MARGIN + 8, y, { width: CONTENT_W - 16, align: "right" });
          }
          y += 14;
        });
        y += 4;
      }

      // Images (if any)
      for (const group of imagePathsByReport.get(report.id) ?? []) {
        if (group.paths.length > 0) {
          y = ensurePage(doc, 40);
          y = drawSectionHeader(doc, `${group.category} (${group.paths.length} صورة)`, y);
          const imgW = (CONTENT_W - 10) / 2;
          const imgH = imgW * 0.65;
          for (const [ii, imgPath] of group.paths.entries()) {
            const col = ii % 2;
            const ix = col === 0 ? MARGIN + imgW + 10 : MARGIN;
            if (col === 0) y = ensurePage(doc, imgH + 10);
            doc.image(imgPath, ix, y, { fit: [imgW, imgH], align: "center" });
            if (col === 1 || ii === group.paths.length - 1) y += imgH + 8;
            if ((ii + 1) % 2 === 0) await yieldToEventLoop();
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════
  // EXTENSIONS PAGE (if any)
  // ════════════════════════════════════════════
  if (extensions.length > 0) {
    doc.addPage();
    if (hasFont) doc.font("Amiri");
    y = MARGIN;
    y = drawSectionHeader(doc, "سجل التمديدات الزمنية", y);

    // Summary box
    const totalDaysAdded = extensions.reduce((s, e) => s + e.daysAdded, 0);
    const latestExt = extensions[extensions.length - 1];
    doc.roundedRect(MARGIN, y, CONTENT_W, 36, 4).fill(C.light).stroke(C.border);
    setFont(8, C.textMuted);
    doc.text("التاريخ الأصلي للإنهاء", MARGIN + 8, y + 8, { width: 120, align: "right" });
    setFont(9, C.textDark);
    doc.text(hasSchedule ? formatDate(project.expectedEndDate) : "—", MARGIN + 8, y + 20, { width: 120, align: "right" });

    setFont(8, C.textMuted);
    doc.text("إجمالي أيام التمديد", MARGIN + 140, y + 8, { width: 100, align: "right" });
    setFont(14, C.warning);
    doc.text(`${totalDaysAdded} يوم`, MARGIN + 140, y + 16, { width: 100, align: "right" });

    setFont(8, C.textMuted);
    doc.text("تاريخ الإنهاء الحالي", MARGIN + 260, y + 8, { width: 120, align: "right" });
    setFont(10, "#92400e");
    doc.text(formatDate(latestExt.newEndDate), MARGIN + 260, y + 20, { width: 120, align: "right" });
    y += 46;

    // Table header
    const extCols = { num: 25, date: 80, days: 55, newEnd: 80, reason: 130, docRef: 80, approvedBy: 60 };
    const extHeaderH = 20;
    doc.rect(MARGIN, y, CONTENT_W, extHeaderH).fill(C.light).stroke(C.border);
    const extHeads = [
      { text: "الجهة الموافِقة", x: MARGIN + 4, w: extCols.approvedBy },
      { text: "رقم الخطاب", x: MARGIN + extCols.approvedBy + 4, w: extCols.docRef },
      { text: "السبب", x: MARGIN + extCols.approvedBy + extCols.docRef + 4, w: extCols.reason },
      { text: "تاريخ الإنهاء الجديد", x: MARGIN + extCols.approvedBy + extCols.docRef + extCols.reason + 4, w: extCols.newEnd },
      { text: "الأيام المضافة", x: MARGIN + extCols.approvedBy + extCols.docRef + extCols.reason + extCols.newEnd + 4, w: extCols.days },
      { text: "تاريخ الاتفاقية", x: MARGIN + extCols.approvedBy + extCols.docRef + extCols.reason + extCols.newEnd + extCols.days + 4, w: extCols.date },
      { text: "#", x: MARGIN + extCols.approvedBy + extCols.docRef + extCols.reason + extCols.newEnd + extCols.days + extCols.date + 4, w: extCols.num },
    ];
    extHeads.forEach(h => {
      setFont(8, C.textMuted);
      doc.text(h.text, h.x, y + 5, { width: h.w, align: "right" });
    });
    y += extHeaderH;

    extensions.forEach((ext, i) => {
      const rowH = 28;
      y = ensurePage(doc, rowH + 10);
      const bg = i % 2 === 0 ? C.white : "#fffbeb";
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(bg).stroke(C.border);

      let cx = MARGIN + 4;
      // approvedBy
      setFont(8, C.textMuted);
      doc.text(ext.approvedBy ?? "—", cx, y + 9, { width: extCols.approvedBy - 6, align: "right" });
      cx += extCols.approvedBy;
      // docRef
      setFont(8, C.textMuted);
      doc.text(ext.documentRef ?? "—", cx + 4, y + 9, { width: extCols.docRef - 6, align: "right" });
      cx += extCols.docRef;
      // reason
      setFont(9, C.textDark);
      doc.text(ext.reason ?? "—", cx + 4, y + 4, { width: extCols.reason - 8, align: "right", height: 20, lineBreak: false });
      cx += extCols.reason;
      // newEndDate
      setFont(9, "#92400e");
      doc.text(formatDate(ext.newEndDate), cx + 4, y + 9, { width: extCols.newEnd - 6, align: "center" });
      cx += extCols.newEnd;
      // daysAdded
      setFont(10, C.warning);
      doc.text(`+${ext.daysAdded}`, cx + 4, y + 7, { width: extCols.days - 6, align: "center" });
      cx += extCols.days;
      // extensionDate
      setFont(9, C.textMuted);
      doc.text(formatDate(ext.extensionDate), cx + 4, y + 9, { width: extCols.date - 6, align: "center" });
      cx += extCols.date;
      // number
      setFont(8, C.textMuted);
      doc.text(String(i + 1), cx + 4, y + 9, { width: extCols.num - 4, align: "center" });

      y += rowH;
    });
  }

  // ════════════════════════════════════════════
  // SUSPENSIONS PAGE (if any)
  // ════════════════════════════════════════════
  if (suspensions.length > 0) {
    doc.addPage();
    if (hasFont) doc.font("Amiri");
    y = MARGIN;
    y = drawSectionHeader(doc, "سجل التوقفات (العطل الرسمية والظروف القاهرة)", y);

    const totalSuspDays = suspensions.reduce((s, x) => s + x.calendarDays, 0);
    doc.roundedRect(MARGIN, y, CONTENT_W, 36, 4).fill(C.light).stroke(C.border);
    setFont(8, C.textMuted);
    doc.text("عدد التوقفات", MARGIN + 8, y + 8, { width: 140, align: "right" });
    setFont(12, C.primary);
    doc.text(String(suspensions.length), MARGIN + 8, y + 18, { width: 140, align: "right" });

    setFont(8, C.textMuted);
    doc.text("إجمالي أيام التوقف", MARGIN + 160, y + 8, { width: 140, align: "right" });
    setFont(14, C.warning);
    doc.text(`${totalSuspDays} يوم`, MARGIN + 160, y + 16, { width: 140, align: "right" });

    y += 46;

    // Table header
    const suspCols = { num: 30, type: 90, start: 80, end: 80, days: 60, reason: 0 };
    suspCols.reason = CONTENT_W - suspCols.num - suspCols.type - suspCols.start - suspCols.end - suspCols.days;

    doc.roundedRect(MARGIN, y, CONTENT_W, 22, 3).fill(C.primary);
    const suspHeaders = [
      { label: "السبب / الملاحظة", w: suspCols.reason },
      { label: "الأيام", w: suspCols.days },
      { label: "تاريخ الانتهاء", w: suspCols.end },
      { label: "تاريخ البدء", w: suspCols.start },
      { label: "النوع", w: suspCols.type },
      { label: "#", w: suspCols.num },
    ];
    let hx = MARGIN;
    suspHeaders.forEach(h => {
      doc.fillColor(C.white).fontSize(8).text(h.label, hx + 4, y + 7, { width: h.w - 6, align: "center" });
      hx += h.w;
    });
    y += 22;

    const rowH = 22;
    const typeLabel = (t: string) => t === "official_holiday" ? "عطلة رسمية" : t === "force_majeure" ? "ظرف قاهر" : "توقف مقاول";

    suspensions.forEach((susp, i) => {
      const rowBg = i % 2 === 0 ? "#ffffff" : C.light;
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(rowBg);
      let cx = MARGIN;
      // reason
      setFont(8, C.textDark);
      doc.text(susp.reason ?? "—", cx + 4, y + 7, { width: suspCols.reason - 6, align: "right" });
      cx += suspCols.reason;
      // days
      setFont(10, C.warning);
      doc.text(String(susp.calendarDays), cx + 4, y + 7, { width: suspCols.days - 6, align: "center" });
      cx += suspCols.days;
      // end
      setFont(9, C.textMuted);
      doc.text(formatDate(susp.endDate), cx + 4, y + 9, { width: suspCols.end - 6, align: "center" });
      cx += suspCols.end;
      // start
      doc.text(formatDate(susp.startDate), cx + 4, y + 9, { width: suspCols.start - 6, align: "center" });
      cx += suspCols.start;
      // type
      setFont(8, susp.type === "official_holiday" ? C.primary : susp.type === "force_majeure" ? "#dc2626" : "#ea580c");
      doc.text(typeLabel(susp.type), cx + 4, y + 9, { width: suspCols.type - 6, align: "center" });
      cx += suspCols.type;
      // num
      setFont(8, C.textMuted);
      doc.text(String(i + 1), cx + 4, y + 9, { width: suspCols.num - 4, align: "center" });
      y += rowH;
    });
  }

  // ════════════════════════════════════════════
  // LAST PAGE: SIGNATURES
  // ════════════════════════════════════════════
  doc.addPage();
  if (hasFont) doc.font("Amiri");
  y = MARGIN;
  y = drawSectionHeader(doc, "التوقيعات والاعتماد", y);

  const sigBoxH = 100;
  const sigBoxY = y + 20;
  
  // Custom Signatures Support
  let sigs = [
    { title: "المقاول المنفذ", name: project.contractor },
    { title: "الجهة المشرفة", name: project.supervisorEntity },
    { title: "الجهة المالكة", name: project.ownerEntity },
  ];
  
  if (project.reportSignatures && Array.isArray(project.reportSignatures)) {
    sigs = (project.reportSignatures as {id: string, title: string, role: string, name?: string}[]).map(sig => ({
      title: sig.title || sig.role,
      name: sig.name || "—"
    }));
  }

  const sigBoxW = sigs.length > 0 ? (CONTENT_W - ((sigs.length - 1) * 10)) / sigs.length : 0;

  sigs.forEach((sig, i) => {
    const sx = MARGIN + i * (sigBoxW + 10);
    doc.roundedRect(sx, sigBoxY, sigBoxW, sigBoxH, 6).stroke(C.border);
    setFont(9, C.primary);
    doc.text(sig.title, sx + 6, sigBoxY + 10, { width: sigBoxW - 12, align: "center" });
    setFont(8, C.textMuted);
    doc.text(sig.name, sx + 6, sigBoxY + 28, { width: sigBoxW - 12, align: "center" });
    doc.moveTo(sx + 12, sigBoxY + 78).lineTo(sx + sigBoxW - 12, sigBoxY + 78).stroke(C.border);
    setFont(7, C.textMuted);
    doc.text("التوقيع والختم", sx + 6, sigBoxY + 82, { width: sigBoxW - 12, align: "center" });
  });

  y = sigBoxY + sigBoxH + 30;
  doc.roundedRect(MARGIN, y, CONTENT_W, 50, 4).fill(C.light).stroke(C.border);
  setFont(9, C.textDark);
  doc.text(`تاريخ الإصدار: ${formatDate(new Date())}  |  المشروع: ${project.name}`, MARGIN + 8, y + 27, { width: CONTENT_W - 16, align: "center" });

  // Retrospective page numbering requires buffered pages. Single-report
  // exports intentionally stream pages so photo-heavy reports stay bounded
  // in memory, therefore they skip this footer pass.
  if (requestedReportId === null) {
    const pageCount = (doc as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      if (hasFont) doc.font("Amiri");
      doc.rect(0, PAGE_H - 28, PAGE_W, 28).fill(C.primary);
      doc.fillColor(C.white).fontSize(8)
        .text(`صفحة ${i + 1} من ${pageCount}  |  نظام الإشراف الهندسي`, MARGIN, PAGE_H - 18, { width: CONTENT_W, align: "center" });
    }
  }

  doc.end();
});

export default router;
