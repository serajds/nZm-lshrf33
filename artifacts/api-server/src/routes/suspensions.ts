import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectSuspensionsTable, projectsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/suspensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const suspensions = await db.select()
    .from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, projectId))
    .orderBy(asc(projectSuspensionsTable.startDate));

  res.json(suspensions);
});

router.post("/projects/:projectId/suspensions", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const { type, title, startDate, endDate, reason, documentRef, approvedBy, notes } = req.body;

  if (!type || !title || !startDate || !endDate) {
    res.status(400).json({ error: "النوع والعنوان وتاريخ البداية والنهاية مطلوبة" });
    return;
  }

  if (!["official_holiday", "force_majeure"].includes(type)) {
    res.status(400).json({ error: "النوع يجب أن يكون عطلة رسمية أو ظرف قاهر" });
    return;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end < start) {
    res.status(400).json({ error: "تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  // Inclusive calendar days: endDate - startDate + 1
  const calendarDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const [suspension] = await db.insert(projectSuspensionsTable).values({
    projectId,
    type: type as "official_holiday" | "force_majeure",
    title,
    startDate,
    endDate,
    calendarDays,
    reason: reason ?? null,
    documentRef: documentRef ?? null,
    approvedBy: approvedBy ?? null,
    notes: notes ?? null,
  }).returning();

  res.status(201).json(suspension);
});

router.delete("/projects/:projectId/suspensions/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const id = parseInt(req.params.id, 10);

  const [deleted] = await db.delete(projectSuspensionsTable)
    .where(and(eq(projectSuspensionsTable.id, id), eq(projectSuspensionsTable.projectId, projectId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "التوقف غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
