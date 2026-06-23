import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityGroupsTable, activitiesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/activity-groups", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const groups = await db.select()
    .from(activityGroupsTable)
    .where(eq(activityGroupsTable.projectId, projectId))
    .orderBy(asc(activityGroupsTable.sortOrder));
  res.json(groups);
});

router.post("/projects/:projectId/activity-groups", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { name, color } = req.body;
  if (!name) {
    res.status(400).json({ error: "اسم المجموعة مطلوب" });
    return;
  }

  const existing = await db.select()
    .from(activityGroupsTable)
    .where(eq(activityGroupsTable.projectId, projectId));
  const maxSort = existing.reduce((m, g) => Math.max(m, g.sortOrder), 0);

  const [group] = await db.insert(activityGroupsTable).values({
    projectId,
    name,
    color: color ?? "#3b82f6",
    sortOrder: maxSort + 1,
  }).returning();
  res.status(201).json(group);
});

router.put("/projects/:projectId/activity-groups/reorder", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { order } = req.body;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order مطلوب" });
    return;
  }
  for (let i = 0; i < order.length; i++) {
    await db.update(activityGroupsTable)
      .set({ sortOrder: i })
      .where(and(eq(activityGroupsTable.id, order[i]), eq(activityGroupsTable.projectId, projectId)));
  }
  res.json({ success: true });
});

router.put("/projects/:projectId/activity-groups/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);
  const { name, color } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (color !== undefined) updateData.color = color;

  const [updated] = await db.update(activityGroupsTable)
    .set(updateData)
    .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  res.json(updated);
});

router.delete("/projects/:projectId/activity-groups/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);

  await db.update(activitiesTable)
    .set({ groupId: null })
    .where(and(eq(activitiesTable.projectId, projectId), eq(activitiesTable.groupId, id)));

  await db.delete(activityGroupsTable)
    .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)));
  res.sendStatus(204);
});

export default router;
