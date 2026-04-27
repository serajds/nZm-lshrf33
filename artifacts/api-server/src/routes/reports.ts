import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportsTable, activitiesTable } from "@workspace/db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { calcActivityPlannedProgress, roundPercent } from "../lib/progress";

type ImageGroup = { category: string; urls: string[] };

const normalizeImageGroups = (groups: unknown): ImageGroup[] | null => {
  if (!Array.isArray(groups)) return null;
  const cleaned: ImageGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const rawUrls = obj.urls;
    if (!category || !Array.isArray(rawUrls)) continue;
    const urls = rawUrls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    cleaned.push({ category, urls });
  }
  return cleaned;
};

const flattenImageGroups = (groups: ImageGroup[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) for (const u of g.urls) if (!seen.has(u)) { seen.add(u); out.push(u); }
  return out;
};

const router: IRouter = Router();

router.get("/projects/:projectId/reports", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { type, dateFrom, dateTo } = req.query;

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

  const conditions = [eq(reportsTable.projectId, projectId)];

  if (type && typeof type === "string" && type !== "all") {
    conditions.push(eq(reportsTable.type, type as "weekly" | "monthly"));
  }

  if (dateFrom && typeof dateFrom === "string") {
    if (!isValidDate(dateFrom)) { res.status(400).json({ error: "dateFrom must be YYYY-MM-DD" }); return; }
    conditions.push(gte(reportsTable.reportDate, dateFrom));
  }

  if (dateTo && typeof dateTo === "string") {
    if (!isValidDate(dateTo)) { res.status(400).json({ error: "dateTo must be YYYY-MM-DD" }); return; }
    conditions.push(lte(reportsTable.reportDate, dateTo));
  }

  const reports = await db.select().from(reportsTable)
    .where(and(...conditions))
    .orderBy(desc(reportsTable.reportDate));

  res.json(reports);
});

router.post("/projects/:projectId/reports", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    type, reportDate, periodStart, periodEnd, workDescription,
    progressPercentage, technicalNotes, recommendations, imageUrls, imageGroups
  } = req.body;

  const groups = normalizeImageGroups(imageGroups);
  const finalImageUrls: string[] = groups && groups.length > 0
    ? flattenImageGroups(groups)
    : (Array.isArray(imageUrls) ? imageUrls.filter((u: unknown): u is string => typeof u === "string") : []);

  if (!type || !reportDate || !periodStart || !periodEnd || !workDescription) {
    res.status(400).json({ error: "جميع الحقول الأساسية مطلوبة" });
    return;
  }

  const [maxResult] = await db.select({ maxNum: sql<number>`COALESCE(MAX(${reportsTable.reportNumber}), 0)` })
    .from(reportsTable)
    .where(eq(reportsTable.projectId, projectId));
  const nextNumber = (maxResult?.maxNum ?? 0) + 1;

  const currentActivities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder);

  const snapshot = currentActivities.map(a => ({
    id: a.id,
    name: a.name,
    plannedStartDate: a.plannedStartDate,
    plannedEndDate: a.plannedEndDate,
    actualStartDate: a.actualStartDate,
    actualEndDate: a.actualEndDate,
    plannedProgress: roundPercent(calcActivityPlannedProgress({
      plannedStartDate: a.plannedStartDate,
      plannedEndDate: a.plannedEndDate,
    })),
    actualProgress: roundPercent(a.actualProgress),
    weight: a.weight ?? 1,
    status: a.status,
    sortOrder: a.sortOrder,
  }));

  const [report] = await db.insert(reportsTable).values({
    projectId,
    reportNumber: nextNumber,
    type,
    reportDate,
    periodStart,
    periodEnd,
    workDescription,
    progressPercentage: progressPercentage ?? 0,
    technicalNotes: technicalNotes ?? null,
    recommendations: recommendations ?? null,
    imageUrls: finalImageUrls,
    imageGroups: groups && groups.length > 0 ? groups : null,
    activitiesSnapshot: snapshot,
    createdById: req.user?.userId ?? null,
  }).returning();

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "create", entityType: "report", entityId: report.id, entityName: `تقرير #${nextNumber}`, projectId });

  res.status(201).json(report);
});

router.get("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [report] = await db.select().from(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  res.json(report);
});

router.patch("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  if (body.type !== undefined) updateData.type = body.type;
  if (body.reportDate !== undefined) updateData.reportDate = body.reportDate;
  if (body.periodStart !== undefined) updateData.periodStart = body.periodStart;
  if (body.periodEnd !== undefined) updateData.periodEnd = body.periodEnd;
  if (body.workDescription !== undefined) updateData.workDescription = body.workDescription;
  if (body.progressPercentage !== undefined) updateData.progressPercentage = body.progressPercentage;
  if (body.technicalNotes !== undefined) updateData.technicalNotes = body.technicalNotes;
  if (body.recommendations !== undefined) updateData.recommendations = body.recommendations;
  if (body.imageGroups !== undefined) {
    const groups = body.imageGroups === null ? null : normalizeImageGroups(body.imageGroups);
    if (groups && groups.length > 0) {
      updateData.imageGroups = groups;
      updateData.imageUrls = flattenImageGroups(groups);
    } else {
      updateData.imageGroups = null;
      updateData.imageUrls = body.imageUrls !== undefined && Array.isArray(body.imageUrls)
        ? body.imageUrls.filter((u: unknown): u is string => typeof u === "string")
        : [];
    }
  } else if (body.imageUrls !== undefined) {
    updateData.imageUrls = body.imageUrls;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [report] = await db.update(reportsTable)
    .set(updateData)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)))
    .returning();

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const { logAudit: logAudit2 } = await import("../lib/audit");
  logAudit2({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "report", entityId: report.id, entityName: `تقرير #${report.reportNumber}`, projectId });

  res.json(report);
});

router.delete("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [report] = await db.delete(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)))
    .returning();

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const { logAudit: logAudit3 } = await import("../lib/audit");
  logAudit3({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "delete", entityType: "report", entityId: id, entityName: `تقرير #${report.reportNumber}`, projectId });

  res.sendStatus(204);
});

export default router;
