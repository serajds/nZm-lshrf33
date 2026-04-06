import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportsTable, activitiesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireProjectAccess } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/reports", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { type } = req.query;

  let query = db.select().from(reportsTable).where(eq(reportsTable.projectId, projectId));

  if (type && typeof type === "string") {
    query = db.select().from(reportsTable)
      .where(and(eq(reportsTable.projectId, projectId), eq(reportsTable.type, type as "weekly" | "monthly")));
  }

  const reports = await query.orderBy(desc(reportsTable.reportDate));
  res.json(reports);
});

router.post("/projects/:projectId/reports", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    type, reportDate, periodStart, periodEnd, workDescription,
    progressPercentage, technicalNotes, recommendations, imageUrls
  } = req.body;

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
    plannedProgress: a.plannedProgress,
    actualProgress: a.actualProgress,
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
    imageUrls: imageUrls ?? [],
    activitiesSnapshot: snapshot,
    createdById: req.user?.userId ?? null,
  }).returning();

  res.status(201).json(report);
});

router.get("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
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

router.patch("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
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
  if (body.imageUrls !== undefined) updateData.imageUrls = body.imageUrls;

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

  res.json(report);
});

router.delete("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
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

  res.sendStatus(204);
});

export default router;
