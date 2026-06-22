import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectExtensionsTable, projectsTable } from "@workspace/db";
import { eq, desc, and, asc } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { recalcExpectedEndDate, getActivitiesBaseEndDate } from "../lib/recalc-end-date";
import { sendPushToUsers, getProjectSupervisorIds } from "../lib/push";

const router: IRouter = Router();

async function recomputeExtensionChain(projectId: number, baseEndDate: string) {
  const allExts = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(asc(projectExtensionsTable.extensionDate));

  let runningEnd = baseEndDate;
  for (const ext of allExts) {
    const parts = runningEnd.split("-").map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() + ext.daysAdded);
    const newEndDate = d.toISOString().split("T")[0];
    await db.update(projectExtensionsTable)
      .set({ newEndDate })
      .where(eq(projectExtensionsTable.id, ext.id));
    runningEnd = newEndDate;
  }
}

router.get("/projects/:projectId/extensions", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);

  const extensions = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId))
    .orderBy(asc(projectExtensionsTable.extensionDate));

  res.json(extensions);
});

router.post("/projects/:projectId/extensions", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("extensions"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);

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

  const baseEnd = await getActivitiesBaseEndDate(projectId) ?? project.expectedEndDate;
  if (baseEnd) {
    await recomputeExtensionChain(projectId, baseEnd);
    await recalcExpectedEndDate(projectId);
  }

  const [updatedExtension] = await db.select()
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.id, extension.id));

  (async () => {
    try {
      const actorId = req.user?.userId;
      const recipients = await getProjectSupervisorIds(projectId, actorId);
      if (recipients.length === 0) return;
      await sendPushToUsers(recipients, {
        title: `تمديد جديد • ${project.name}`,
        body: `+${Number(daysAdded)} يوم • تاريخ التمديد ${extensionDate}`,
        url: `/projects/${projectId}/extensions`,
        tag: `extension-${projectId}`,
        data: { kind: "extension", projectId, extensionId: extension.id },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[push] extension dispatch failed:", err);
    }
  })();

  res.status(201).json(updatedExtension);
});

router.delete("/projects/:projectId/extensions/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("extensions"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);

  const [deleted] = await db.delete(projectExtensionsTable)
    .where(and(eq(projectExtensionsTable.id, id), eq(projectExtensionsTable.projectId, projectId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "التمديد غير موجود" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project) {
    const baseEnd = await getActivitiesBaseEndDate(projectId) ?? project.expectedEndDate;
    if (baseEnd) {
      await recomputeExtensionChain(projectId, baseEnd);
    }
  }
  await recalcExpectedEndDate(projectId);

  res.sendStatus(204);
});

export default router;
