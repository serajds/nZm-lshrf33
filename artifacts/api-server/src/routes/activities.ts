import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, projectsTable } from "@workspace/db";
import { eq, and, avg } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";

const router: IRouter = Router();

async function syncProjectProgress(projectId: number) {
  const [result] = await db
    .select({ avgProgress: avg(activitiesTable.actualProgress) })
    .from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId));

  const computed = result?.avgProgress ? Math.round(Number(result.avgProgress)) : 0;

  await db
    .update(projectsTable)
    .set({ overallProgress: computed })
    .where(eq(projectsTable.id, projectId));
}

router.get("/projects/:projectId/activities", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder, activitiesTable.id);

  res.json(activities);
});

router.post("/projects/:projectId/activities", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    name, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate,
    plannedProgress, actualProgress, status, sortOrder
  } = req.body;

  if (!name || !plannedStartDate || !plannedEndDate) {
    res.status(400).json({ error: "الاسم وتاريخ البداية والنهاية المخططة مطلوبة" });
    return;
  }

  const [activity] = await db.insert(activitiesTable).values({
    projectId,
    name,
    plannedStartDate,
    plannedEndDate,
    actualStartDate: actualStartDate ?? null,
    actualEndDate: actualEndDate ?? null,
    plannedProgress: plannedProgress ?? 0,
    actualProgress: actualProgress ?? 0,
    status: status ?? "not_started",
    sortOrder: sortOrder ?? 0,
  }).returning();

  await syncProjectProgress(projectId);

  res.status(201).json(activity);
});

router.patch("/projects/:projectId/activities/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const updateData: Record<string, unknown> = {};
  const allowed = ["name", "plannedStartDate", "plannedEndDate", "actualStartDate", "actualEndDate", "plannedProgress", "actualProgress", "status", "sortOrder"];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [activity] = await db.update(activitiesTable)
    .set(updateData)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
    .returning();

  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  await syncProjectProgress(projectId);

  res.json(activity);
});

router.delete("/projects/:projectId/activities/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [activity] = await db.delete(activitiesTable)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
    .returning();

  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  await syncProjectProgress(projectId);

  res.sendStatus(204);
});

export default router;
