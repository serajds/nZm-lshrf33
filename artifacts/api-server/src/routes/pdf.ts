import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, reportsTable, activitiesTable, projectExtensionsTable, projectSuspensionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireProjectAccess } from "../middlewares/auth";
import { calcPlannedProgressForProject, calcActualProgressForProject, calcDelayDays, calcActivityPlannedProgress, isActivityDelayed, roundPercent } from "../lib/progress";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { streamFromCloud } from "../lib/fileStorage";
import { pipeline } from "stream/promises";

async function resolveImagePath(imgUrl: string, uploadsDir: string): Promise<string | null> {
  const filename = path.basename(imgUrl.split("?")[0]);
  const localPath = path.join(uploadsDir, filename);
  if (fs.existsSync(localPath)) return localPath;

  const cloudResult = await streamFromCloud(filename);
  if (!cloudResult) return null;

  const tmpPath = path.join(uploadsDir, filename);
  const ws = fs.createWriteStream(tmpPath);
  await pipeline(cloudResult.stream as NodeJS.ReadableStream, ws);
  return tmpPath;
}

const AMIRI_FONT = path.join(process.cwd(), "src/fonts/Amiri-Regular.ttf");
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;

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
  return new Date(d).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
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

// ─────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────
router.get("/projects/:projectId/reports/export-pdf", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.projectId, projectId))
    .orderBy(reportsTable.reportDate);

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder);

  const extensions = await db.select().from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(projectExtensionsTable.extensionDate);

  const suspensions = await db.select().from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, projectId))
    .orderBy(projectSuspensionsTable.startDate);

  const hasFont = fs.existsSync(AMIRI_FONT);

  const doc = new PDFDocument({
    margin: MARGIN,
    size: "A4",
    info: {
      Title: `تقرير المشروع الشامل - ${project.name}`,
      Author: "إدارة الإشراف والمتابعة",
    },
    bufferPages: true,
  });

  if (hasFont) { doc.registerFont("Amiri", AMIRI_FONT); doc.font("Amiri"); }
  const setFont = (size: number, color = C.textDark) => {
    if (hasFont) doc.font("Amiri");
    doc.fontSize(size).fillColor(color);
  };

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''report-${projectId}.pdf`);
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

  const isNoSchedule = project.noSchedule === true;

  const infoItems: [string, string | null][] = [
    ["الجهة المالكة", project.ownerEntity],
    ["المقاول المنفذ", project.contractor],
    ["الجهة المشرفة", project.supervisorEntity],
    ["موقع المشروع", project.location],
    ...(project.startDate ? [["تاريخ البداية", formatDate(project.startDate)] as [string, string]] : []),
    ...(!isNoSchedule && project.expectedEndDate ? [["التاريخ المتوقع للإنهاء", formatDate(project.expectedEndDate)] as [string, string]] : []),
    ...(isNoSchedule ? [["حالة الجدول الزمني", "بدون جدول زمني معتمد"] as [string, string]] : []),
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
    doc.text("مشروع بدون جدول زمني معتمد — لا يُحسب التأخير", MARGIN + 8, y + 44, { width: CONTENT_W - 16, align: "right" });

    y += 70;
  } else {
    const today = new Date();
    const start = new Date(project.startDate!);
    const end = new Date(project.expectedEndDate!);
    const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    const elapsed = Math.max(0, Math.ceil((today.getTime() - start.getTime()) / 86400000));
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
    y = drawSectionHeader(doc, "جدول بنود الأعمال والإنجاز", y);

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

    activities.forEach((a, i) => {
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
    });

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
      const report = reports[idx];
      doc.addPage();
      if (hasFont) doc.font("Amiri");
      y = MARGIN;

      // Report header
      const typeColor = report.type === "monthly" ? C.primary : C.accent;
      doc.rect(MARGIN, y, CONTENT_W, 50).fill(typeColor);
      setFont(9, C.white);
      doc.text(`تقرير ${reportTypeLabel(report.type)}  —  ${idx + 1} من ${reports.length}`, MARGIN + 8, y + 8, { width: CONTENT_W - 16, align: "right" });
      setFont(12, C.white);
      doc.text(`الفترة: ${formatDate(report.periodStart)} — ${formatDate(report.periodEnd)}`, MARGIN + 8, y + 24, { width: CONTENT_W - 16, align: "right" });
      setFont(8, "rgba(255,255,255,0.8)");
      doc.text(`تاريخ التقرير: ${formatDate(report.reportDate)}`, MARGIN + 8, y + 40, { width: CONTENT_W - 16, align: "right" });
      y += 58;

      // Progress indicator for this report
      doc.roundedRect(MARGIN, y, CONTENT_W, 32, 4).fill(C.light).stroke(C.border);
      setFont(8, C.textMuted);
      doc.text("نسبة الإنجاز المُبلَّغ عنها في هذه الفترة", MARGIN + 8, y + 6, { width: CONTENT_W - 100, align: "right" });
      drawProgressBar(doc, MARGIN + 8, y + 20, CONTENT_W - 100, 8, report.progressPercentage ?? 0, typeColor);
      setFont(14, typeColor);
      doc.text(`${report.progressPercentage ?? 0}%`, MARGIN + CONTENT_W - 88, y + 8, { width: 80, align: "center" });
      y += 42;

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
      if (report.imageUrls && report.imageUrls.length > 0) {
        const uploadsDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const validImgs: string[] = [];
        for (const imgUrl of report.imageUrls) {
          try {
            const resolved = await resolveImagePath(imgUrl, uploadsDir);
            if (resolved) validImgs.push(resolved);
          } catch { /* skip */ }
        }
        if (validImgs.length > 0) {
          y = ensurePage(doc, 40);
          y = drawSectionHeader(doc, `صور الموقع (${validImgs.length})`, y);
          const imgW = (CONTENT_W - 10) / 2;
          const imgH = imgW * 0.65;
          validImgs.forEach((imgPath, ii) => {
            const col = ii % 2;
            const ix = col === 0 ? MARGIN + imgW + 10 : MARGIN;
            if (col === 0) y = ensurePage(doc, imgH + 10);
            try {
              doc.image(imgPath, ix, y, { fit: [imgW, imgH], align: "center" });
            } catch { /* skip */ }
            if (col === 1 || ii === validImgs.length - 1) y += imgH + 8;
          });
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
    doc.text(project.expectedEndDate ? formatDate(project.expectedEndDate) : "—", MARGIN + 8, y + 20, { width: 120, align: "right" });

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

  const sigBoxW = (CONTENT_W - 20) / 3;
  const sigBoxH = 100;
  const sigBoxY = y + 20;
  const sigs = [
    { title: "المقاول المنفذ", name: project.contractor },
    { title: "الجهة المشرفة", name: project.supervisorEntity },
    { title: "الجهة المالكة", name: project.ownerEntity },
  ];
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
  setFont(8, C.textMuted);
  doc.text("صدر هذا التقرير من إدارة الإشراف والمتابعة", MARGIN + 8, y + 10, { width: CONTENT_W - 16, align: "center" });
  setFont(9, C.textDark);
  doc.text(`تاريخ الإصدار: ${formatDate(new Date())}  |  المشروع: ${project.name}`, MARGIN + 8, y + 27, { width: CONTENT_W - 16, align: "center" });

  // Page numbers
  const pageCount = (doc as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    if (hasFont) doc.font("Amiri");
    doc.rect(0, PAGE_H - 28, PAGE_W, 28).fill(C.primary);
    doc.fillColor(C.white).fontSize(8)
      .text(`صفحة ${i + 1} من ${pageCount}  |  نظام الإشراف الهندسي`, MARGIN, PAGE_H - 18, { width: CONTENT_W, align: "center" });
  }

  doc.end();
});

export default router;
