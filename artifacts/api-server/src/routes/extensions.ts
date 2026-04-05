import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectExtensionsTable, projectsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/extensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const extensions = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(projectExtensionsTable.extensionDate);

  res.json(extensions);
});

router.post("/projects/:projectId/extensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const { extensionDate, daysAdded, reason, documentRef, approvedBy, notes } = req.body;

  if (!extensionDate || !daysAdded || isNaN(Number(daysAdded)) || Number(daysAdded) <= 0) {
    res.status(400).json({ error: "تاريخ التمديد وعدد الأيام مطلوبان" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const [lastExt] = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(desc(projectExtensionsTable.extensionDate))
    .limit(1);

  const baseDate = lastExt ? new Date(lastExt.newEndDate) : new Date(project.expectedEndDate);
  const newEnd = new Date(baseDate);
  newEnd.setDate(newEnd.getDate() + Number(daysAdded));
  const newEndDate = newEnd.toISOString().split("T")[0];

  const [extension] = await db.insert(projectExtensionsTable).values({
    projectId,
    extensionDate,
    daysAdded: Number(daysAdded),
    newEndDate,
    reason: reason ?? null,
    documentRef: documentRef ?? null,
    approvedBy: approvedBy ?? null,
    notes: notes ?? null,
  }).returning();

  res.status(201).json(extension);
});

router.delete("/projects/:projectId/extensions/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [ext] = await db.delete(projectExtensionsTable)
    .where(and(eq(projectExtensionsTable.id, id), eq(projectExtensionsTable.projectId, projectId)))
    .returning();

  if (!ext) {
    res.status(404).json({ error: "التمديد غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
