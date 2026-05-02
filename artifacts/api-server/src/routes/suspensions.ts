import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectSuspensionsTable, projectsTable, activitiesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { sendPushToUsers, getProjectSupervisorIds } from "../lib/push";

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
    if (!activity.plannedStartDate || !activity.plannedEndDate) continue;
    const actStart = new Date(activity.plannedStartDate);
    const actEnd = new Date(activity.plannedEndDate);
    const shift = calendarDays * direction;

    if (actStart >= suspStart) {
      await db.update(activitiesTable)
        .set({
          plannedStartDate: addDays(activity.plannedStartDate, shift),
          plannedEndDate: addDays(activity.plannedEndDate, shift),
        })
        .where(eq(activitiesTable.id, activity.id));
    } else if (actEnd >= suspStart) {
      await db.update(activitiesTable)
        .set({ plannedEndDate: addDays(activity.plannedEndDate, shift) })
        .where(eq(activitiesTable.id, activity.id));
    }
  }
}

router.get("/projects/:projectId/suspensions", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);

  const suspensions = await db.select()
    .from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, projectId))
    .orderBy(asc(projectSuspensionsTable.startDate));

  res.json(suspensions);
});

router.post("/projects/:projectId/suspensions", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);

  const { type, title, startDate, endDate, reason, documentRef, approvedBy, notes, shiftDates } = req.body;

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

  const shouldShift = shiftDates === true && (RECALC_TYPES as readonly string[]).includes(type);

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
    datesShifted: shouldShift,
  }).returning();

  if (shouldShift) {
    await shiftActivities(projectId, startDate, calendarDays, 1);
    if (project.expectedEndDate) {
      await db.update(projectsTable)
        .set({ expectedEndDate: addDays(project.expectedEndDate, calendarDays) })
        .where(eq(projectsTable.id, projectId));
    }
  }

  (async () => {
    try {
      const actorId = req.user?.userId;
      const recipients = await getProjectSupervisorIds(projectId, actorId);
      if (recipients.length === 0) return;
      const typeLabel = type === "official_holiday" ? "عطلة رسمية" : type === "force_majeure" ? "قوة قاهرة" : "تأخير المقاول";
      await sendPushToUsers(recipients, {
        title: `توقّف جديد • ${project.name}`,
        body: `${title} • ${typeLabel} (${calendarDays} يوم)`,
        url: `/projects/${projectId}/suspensions`,
        tag: `suspension-${projectId}`,
        data: { kind: "suspension", projectId, suspensionId: suspension.id },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[push] suspension dispatch failed:", err);
    }
  })();

  res.status(201).json({ ...suspension, activitiesShifted: shouldShift });
});

router.delete("/projects/:projectId/suspensions/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);

  const [susp] = await db.select()
    .from(projectSuspensionsTable)
    .where(and(eq(projectSuspensionsTable.id, id), eq(projectSuspensionsTable.projectId, projectId)));

  if (!susp) {
    res.status(404).json({ error: "التوقف غير موجود" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));

  await db.delete(projectSuspensionsTable)
    .where(and(eq(projectSuspensionsTable.id, id), eq(projectSuspensionsTable.projectId, projectId)));

  if (susp.datesShifted) {
    await shiftActivities(projectId, susp.startDate, susp.calendarDays, -1);
    if (project?.expectedEndDate) {
      await db.update(projectsTable)
        .set({ expectedEndDate: addDays(project.expectedEndDate, -susp.calendarDays) })
        .where(eq(projectsTable.id, projectId));
    }
  }

  res.sendStatus(204);
});

export default router;
