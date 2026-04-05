import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectExtensionsTable, projectsTable } from "@workspace/db";
import { eq, desc, and, asc } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/extensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const extensions = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(asc(projectExtensionsTable.extensionDate));

  res.json(extensions);
});

router.post("/projects/:projectId/extensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

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

  // Insert with a placeholder newEndDate; full chain will be recomputed below
  const [extension] = await db.insert(projectExtensionsTable).values({
    projectId,
    extensionDate,
    daysAdded: Number(daysAdded),
    newEndDate: extensionDate, // temporary; overwritten immediately
    reason: reason ?? null,
    documentRef: documentRef ?? null,
    approvedBy: approvedBy ?? null,
    notes: notes ?? null,
  }).returning();

  // Recompute new_end_date for all extensions in chronological order
  // so backdated inserts don't create an inconsistent chain
  const allExts = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(asc(projectExtensionsTable.extensionDate));

  let runningEnd = new Date(project.expectedEndDate);
  let updatedExtension = extension;
  for (const ext of allExts) {
    const next = new Date(runningEnd);
    next.setDate(next.getDate() + ext.daysAdded);
    const newEndDate = next.toISOString().split("T")[0];
    const [updated] = await db.update(projectExtensionsTable)
      .set({ newEndDate })
      .where(eq(projectExtensionsTable.id, ext.id))
      .returning();
    if (ext.id === extension.id) updatedExtension = updated;
    runningEnd = next;
  }

  res.status(201).json(updatedExtension);
});

router.delete("/projects/:projectId/extensions/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const id = parseInt(req.params.id, 10);

  const [deleted] = await db.delete(projectExtensionsTable)
    .where(and(eq(projectExtensionsTable.id, id), eq(projectExtensionsTable.projectId, projectId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "التمديد غير موجود" });
    return;
  }

  // Recompute new_end_date for all remaining extensions in chronological order
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project) {
    const remaining = await db.select()
      .from(projectExtensionsTable)
      .where(eq(projectExtensionsTable.projectId, projectId))
      .orderBy(asc(projectExtensionsTable.extensionDate));

    let runningEnd = new Date(project.expectedEndDate);
    for (const ext of remaining) {
      const next = new Date(runningEnd);
      next.setDate(next.getDate() + ext.daysAdded);
      const newEndDate = next.toISOString().split("T")[0];
      await db.update(projectExtensionsTable)
        .set({ newEndDate })
        .where(eq(projectExtensionsTable.id, ext.id));
      runningEnd = next;
    }
  }

  res.sendStatus(204);
});

export default router;
