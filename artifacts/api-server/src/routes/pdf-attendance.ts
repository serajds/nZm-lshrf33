import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { attendanceRecordsTable, projectsTable, usersTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

const AMIRI_FONT = path.join(process.cwd(), "src/fonts/Amiri-Regular.ttf");
const PAGE_W = 595.28;
const MARGIN = 45;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TZ = "Africa/Tripoli";

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

const ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام",
  project_manager: "مدير المشروع",
  engineer: "مهندس",
  contractor: "مقاول",
  owner: "صاحب المشروع",
};

const router: IRouter = Router();

router.get("/pdf/attendance-report", requireAuth, async (req, res): Promise<void> => {
  const projectId = parseInt(String(req.query.projectId ?? ""), 10);
  const userId = parseInt(String(req.query.userId ?? ""), 10);
  const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : null;
  const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : null;

  if (!projectId || !userId) { res.status(400).json({ error: "projectId و userId مطلوبان" }); return; }

  // Permission: self OR admin OR project_manager of that project
  const reqUser = req.user!;
  if (reqUser.userId !== userId && reqUser.role !== "admin") {
    const { projectMembersTable } = await import("@workspace/db");
    const [pm] = await db.select()
      .from(projectMembersTable)
      .where(and(eq(projectMembersTable.userId, reqUser.userId), eq(projectMembersTable.projectId, projectId)));
    if (!pm || (pm.role !== "project_manager" && reqUser.role !== "project_manager")) {
      res.status(403).json({ error: "ليس لديك صلاحية" });
      return;
    }
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const [employee] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!project || !employee) { res.status(404).json({ error: "غير موجود" }); return; }

  const conditions = [eq(attendanceRecordsTable.projectId, projectId), eq(attendanceRecordsTable.userId, userId)];
  // Africa/Tripoli day boundaries (GMT+2, no DST)
  if (dateFrom) conditions.push(gte(attendanceRecordsTable.recordedAt, new Date(dateFrom + "T00:00:00+02:00")));
  if (dateTo) conditions.push(lte(attendanceRecordsTable.recordedAt, new Date(dateTo + "T23:59:59.999+02:00")));
  const records = await db.select().from(attendanceRecordsTable).where(and(...conditions)).orderBy(attendanceRecordsTable.recordedAt);

  const byDay = new Map<string, { checkIn: Date | null; checkOut: Date | null }>();
  for (const r of records) {
    const day = fmtDate(new Date(r.recordedAt));
    let entry = byDay.get(day);
    if (!entry) { entry = { checkIn: null, checkOut: null }; byDay.set(day, entry); }
    if (r.type === "check_in" && !entry.checkIn) entry.checkIn = new Date(r.recordedAt);
    if (r.type === "check_out") entry.checkOut = new Date(r.recordedAt);
  }
  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const hasFont = fs.existsSync(AMIRI_FONT);
  if (hasFont) { doc.registerFont("Amiri", AMIRI_FONT); doc.font("Amiri"); }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="attendance-${userId}.pdf"`);
  doc.pipe(res);

  // Header
  doc.fillColor("#1e3a5f").rect(MARGIN, MARGIN, CONTENT_W, 50).fill();
  doc.fillColor("#ffffff").fontSize(16).text("تقرير حضور وانصراف موظف", MARGIN + 10, MARGIN + 14, { width: CONTENT_W - 20, align: "center" });

  let y = MARGIN + 70;

  doc.fillColor("#1e293b").fontSize(11);
  const rowH = 18;
  const writeRow = (label: string, value: string) => {
    doc.fillColor("#64748b").text(label, MARGIN + CONTENT_W / 2, y, { width: CONTENT_W / 2 - 10, align: "right" });
    doc.fillColor("#1e293b").text(value, MARGIN, y, { width: CONTENT_W / 2 - 10, align: "right" });
    y += rowH;
  };
  writeRow("المشروع:", project.name);
  writeRow("الموظف:", employee.fullName);
  writeRow("الدور:", ROLE_LABEL[employee.role] ?? employee.role);
  writeRow("هاتف:", employee.phone ?? "—");
  writeRow("الفترة:", `${dateFrom ?? "—"}  ←  ${dateTo ?? "—"}`);
  writeRow("توقيت:", "ليبيا (GMT+2)");

  y += 12;

  // Table header
  const cols = [
    { label: "التاريخ", w: CONTENT_W * 0.4 },
    { label: "وقت الحضور", w: CONTENT_W * 0.3 },
    { label: "وقت الانصراف", w: CONTENT_W * 0.3 },
  ];
  doc.fillColor("#1e3a5f").rect(MARGIN, y, CONTENT_W, 24).fill();
  let cx = MARGIN;
  doc.fillColor("#ffffff").fontSize(11);
  for (const c of cols) {
    doc.text(c.label, cx + 4, y + 7, { width: c.w - 8, align: "center" });
    cx += c.w;
  }
  y += 24;

  doc.fillColor("#1e293b").fontSize(11);
  if (days.length === 0) {
    doc.fillColor("#64748b").text("لا توجد سجلات لهذه الفترة.", MARGIN, y + 10, { width: CONTENT_W, align: "center" });
  } else {
    for (const [date, v] of days) {
      if (y > 760) { doc.addPage(); if (hasFont) doc.font("Amiri"); y = MARGIN; }
      const rowBg = (Math.floor((y - MARGIN) / 22) % 2 === 0) ? "#f8fafc" : "#ffffff";
      doc.fillColor(rowBg).rect(MARGIN, y, CONTENT_W, 22).fill();
      cx = MARGIN;
      doc.fillColor("#1e293b").fontSize(11);
      const cells = [date, fmtTime(v.checkIn), fmtTime(v.checkOut)];
      for (let i = 0; i < cols.length; i++) {
        doc.text(cells[i], cx + 4, y + 6, { width: cols[i].w - 8, align: "center" });
        cx += cols[i].w;
      }
      y += 22;
    }
  }

  // Page numbers
  const pageCount = (doc as { _pageBuffer?: unknown[] })._pageBuffer?.length ?? 1;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    if (hasFont) doc.font("Amiri");
    doc.fillColor("#64748b").fontSize(8).text(
      `صفحة ${i + 1} من ${pageCount}  |  تاريخ الإصدار: ${fmtDate(new Date())}`,
      MARGIN, 815, { width: CONTENT_W, align: "center" },
    );
  }

  doc.end();
});

export default router;
