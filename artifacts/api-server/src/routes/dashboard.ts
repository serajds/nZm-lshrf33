import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable } from "@workspace/db";
import { eq, count, avg, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/dashboard/summary", requireAuth, async (_req, res): Promise<void> => {
  const [totals] = await db.select({
    total: count(),
    avgProgress: avg(projectsTable.overallProgress),
  }).from(projectsTable);

  const statusCounts = await db.select({
    status: projectsTable.status,
    cnt: count(),
  }).from(projectsTable).groupBy(projectsTable.status);

  const [reportCount] = await db.select({ count: count() }).from(reportsTable);

  const recentProjects = await db.select().from(projectsTable)
    .orderBy(sql`${projectsTable.updatedAt} DESC`)
    .limit(5);

  const countByStatus = (status: string) => {
    const found = statusCounts.find(s => s.status === status);
    return found ? Number(found.cnt) : 0;
  };

  res.json({
    totalProjects: Number(totals?.total ?? 0),
    activeProjects: countByStatus("active"),
    completedProjects: countByStatus("completed"),
    delayedProjects: countByStatus("delayed"),
    averageProgress: Number(totals?.avgProgress ?? 0),
    totalReports: Number(reportCount?.count ?? 0),
    recentProjects,
  });
});

router.get("/projects/:projectId/summary", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  const [reportCount] = await db.select({ count: count() }).from(reportsTable).where(eq(reportsTable.projectId, projectId));
  const [fileCount] = await db.select({ count: count() }).from(projectFilesTable).where(eq(projectFilesTable.projectId, projectId));

  const today = new Date();
  const startDate = new Date(project.startDate);
  const endDate = new Date(project.expectedEndDate);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  const plannedProgress = Math.min(100, (daysElapsed / totalDays) * 100);
  const delayDays = project.overallProgress < plannedProgress ? Math.round((plannedProgress - project.overallProgress) / 100 * totalDays) : 0;

  res.json({
    projectId,
    overallProgress: project.overallProgress,
    plannedProgress,
    activitiesTotal: activities.length,
    activitiesCompleted: activities.filter(a => a.status === "completed").length,
    activitiesDelayed: activities.filter(a => a.status === "delayed").length,
    daysElapsed,
    totalDays,
    daysRemaining,
    delayDays,
    reportsCount: Number(reportCount?.count ?? 0),
    filesCount: Number(fileCount?.count ?? 0),
  });
});

router.get("/projects/:projectId/deviation", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));

  const today = new Date();
  const startDate = new Date(project.startDate);
  const endDate = new Date(project.expectedEndDate);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const plannedProgress = Math.min(100, (daysElapsed / totalDays) * 100);

  const progressDeviation = project.overallProgress - plannedProgress;
  const timeDeviation = progressDeviation < -10 ? (plannedProgress - project.overallProgress) / 100 * totalDays : 0;

  let overallStatus: "on_track" | "slightly_delayed" | "significantly_delayed" | "ahead";
  if (progressDeviation > 5) {
    overallStatus = "ahead";
  } else if (progressDeviation >= -5) {
    overallStatus = "on_track";
  } else if (progressDeviation >= -15) {
    overallStatus = "slightly_delayed";
  } else {
    overallStatus = "significantly_delayed";
  }

  const activitiesAnalysis = activities.map(a => {
    const deviation = a.actualProgress - a.plannedProgress;
    let delayDays: number | null = null;

    if (a.status === "delayed" && a.plannedEndDate) {
      const plannedEnd = new Date(a.plannedEndDate);
      const todayTime = today.getTime();
      const plannedTime = plannedEnd.getTime();
      if (todayTime > plannedTime) {
        delayDays = Math.ceil((todayTime - plannedTime) / (1000 * 60 * 60 * 24));
      }
    }

    return {
      activityId: a.id,
      activityName: a.name,
      plannedProgress: a.plannedProgress,
      actualProgress: a.actualProgress,
      deviation,
      delayDays,
    };
  });

  res.json({
    projectId,
    timeDeviation,
    progressDeviation,
    status: overallStatus,
    activitiesAnalysis,
  });
});

export default router;
