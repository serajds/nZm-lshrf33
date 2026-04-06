import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectSuspensionsTable, projectsTable, activitiesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireProjectAccess } from "../middlewares/auth";

const router: IRouter = Router();

const RECALC_TYPES = ["official_holiday", "force_majeure"] as const;
const ALL_TYPES = ["official_holiday", "force_majeure", "contractor_delay"] as const;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

async function shiftActivities(projectId: number, suspStartDate: string, calendarDays: number, direction: 1 | -1) {
  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  const suspStart = new Date(suspStartDate);

  for (const activity of activities) {
    const actStart = new Date(activity.plannedStartDate);
    const actEnd = new Date(activity.plannedEndDate);
    const shift = calendarDays * direction;

    if (actStart >= suspStart) {
      // Activity starts on or after suspension: shift both dates
      await db.update(activitiesTable)
        .set({
          plannedStartDate: addDays(activity.plannedStartDate, shift),
          plannedEndDate: addDays(activity.plannedEndDate, shift),
        })
        .where(eq(activitiesTable.id, activity.id));
    } else if (actEnd >= suspStart) {
      // Activity spans the suspension: only extend/shorten end date
      await db.update(activitiesTable)
        .set({ plannedEndDate: addDays(activity.plannedEndDate, shift) })
        .where(eq(activitiesTable.id, activity.id));
    }
  }
}

router.get("/projects/:projectId/suspensions", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const suspensions = await db.select()
    .from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, projectId))
    .orderBy(asc(projectSuspensionsTable.startDate));

  res.json(suspensions);
});

router.post("/projects/:projectId/suspensions", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);

  const { type, title, startDate, endDate, reason, documentRef, approvedBy, notes } = req.body;

  if (!type || !title || !startDate || !endDate) {
    res.status(400).json({ error: "النوع والعنوان وتاريخ البداية والنهاية مطلوبة" });
    return;
  }

  if (!ALL_TYPES.includes(type)) {
    res.status(400).json({ error: "نوع التوقف غير صحيح" });
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

  const calendarDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const [suspension] = await db.insert(projectSuspensionsTable).values({
    projectId,
    type: type as typeof ALL_TYPES[number],
    title,
    startDate,
    endDate,
    calendarDays,
    reason: reason ?? null,
    documentRef: documentRef ?? null,
    approvedBy: approvedBy ?? null,
    notes: notes ?? null,
  }).returning();

  // Shift activity planned dates only for legitimate suspensions (not contractor delay)
  if ((RECALC_TYPES as readonly string[]).includes(type)) {
    await shiftActivities(projectId, startDate, calendarDays, 1);
  }

  res.status(201).json({ ...suspension, activitiesShifted: (RECALC_TYPES as readonly string[]).includes(type) });
});

router.delete("/projects/:projectId/suspensions/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId, 10);
  const id = parseInt(req.params.id, 10);

  const [susp] = await db.select()
    .from(projectSuspensionsTable)
    .where(and(eq(projectSuspensionsTable.id, id), eq(projectSuspensionsTable.projectId, projectId)));

  if (!susp) {
    res.status(404).json({ error: "التوقف غير موجود" });
    return;
  }

  await db.delete(projectSuspensionsTable)
    .where(and(eq(projectSuspensionsTable.id, id), eq(projectSuspensionsTable.projectId, projectId)));

  // Reverse activity shift for legitimate suspensions (not contractor delay)
  if ((RECALC_TYPES as readonly string[]).includes(susp.type)) {
    await shiftActivities(projectId, susp.startDate, susp.calendarDays, -1);
  }

  res.sendStatus(204);
});

export default router;
