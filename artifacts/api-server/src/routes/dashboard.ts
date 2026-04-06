import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectSuspensionsTable, projectMembersTable } from "@workspace/db";
import { eq, count, avg, sql, desc, inArray } from "drizzle-orm";
import { requireEngineerOrAdmin, requireProjectAccess } from "../middlewares/auth";
import { calcPlannedProgressForProject, calcDelayDays } from "../lib/progress";

const router: IRouter = Router();

router.get("/dashboard/summary", requireEngineerOrAdmin, async (_req, res): Promise<void> => {
  const userRole = _req.user?.role;
  const userId = _req.user?.userId;

  let projectFilter: number[] | null = null;
  if (userRole !== "admin" && userId) {
    const memberships = await db.select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, userId));
    projectFilter = memberships.map(m => m.projectId);
  }

  const baseProjectQuery = projectFilter && projectFilter.length > 0
    ? db.select().from(projectsTable).where(inArray(projectsTable.id, projectFilter))
    : projectFilter && projectFilter.length === 0
    ? null
    : db.select().from(projectsTable);

  if (!baseProjectQuery) {
    res.json({
      totalProjects: 0, activeProjects: 0, completedProjects: 0,
      delayedProjects: 0, suspendedProjects: 0, averageProgress: 0,
      totalReports: 0, totalActivities: 0, completedActivities: 0,
      delayedActivities: 0, inProgressActivities: 0,
      recentProjects: [], allProjects: [], recentReports: [],
    });
    return;
  }

  const [totals] = projectFilter
    ? await db.select({
        total: count(),
        avgProgress: avg(projectsTable.overallProgress),
      }).from(projectsTable).where(inArray(projectsTable.id, projectFilter))
    : await db.select({
        total: count(),
        avgProgress: avg(projectsTable.overallProgress),
      }).from(projectsTable);

  const statusCounts = projectFilter
    ? await db.select({ status: projectsTable.status, cnt: count() })
        .from(projectsTable).where(inArray(projectsTable.id, projectFilter)).groupBy(projectsTable.status)
    : await db.select({ status: projectsTable.status, cnt: count() })
        .from(projectsTable).groupBy(projectsTable.status);

  const [reportCount] = projectFilter
    ? await db.select({ count: count() }).from(reportsTable).where(inArray(reportsTable.projectId, projectFilter))
    : await db.select({ count: count() }).from(reportsTable);

  const activityCounts = projectFilter
    ? await db.select({ status: activitiesTable.status, cnt: count() })
        .from(activitiesTable).where(inArray(activitiesTable.projectId, projectFilter)).groupBy(activitiesTable.status)
    : await db.select({ status: activitiesTable.status, cnt: count() })
        .from(activitiesTable).groupBy(activitiesTable.status);

  const recentProjects = projectFilter
    ? await db.select().from(projectsTable)
        .where(inArray(projectsTable.id, projectFilter))
        .orderBy(sql`${projectsTable.updatedAt} DESC`).limit(8)
    : await db.select().from(projectsTable)
        .orderBy(sql`${projectsTable.updatedAt} DESC`).limit(8);

  const allProjects = projectFilter
    ? await db.select({
        id: projectsTable.id, name: projectsTable.name,
        overallProgress: projectsTable.overallProgress, status: projectsTable.status,
        startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
        ownerEntity: projectsTable.ownerEntity,
      }).from(projectsTable).where(inArray(projectsTable.id, projectFilter)).orderBy(desc(projectsTable.overallProgress))
    : await db.select({
        id: projectsTable.id, name: projectsTable.name,
        overallProgress: projectsTable.overallProgress, status: projectsTable.status,
        startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
        ownerEntity: projectsTable.ownerEntity,
      }).from(projectsTable).orderBy(desc(projectsTable.overallProgress));

  const recentReports = projectFilter
    ? await db.select({
        id: reportsTable.id, projectId: reportsTable.projectId,
        type: reportsTable.type, reportDate: reportsTable.reportDate,
        progressPercentage: reportsTable.progressPercentage,
      }).from(reportsTable).where(inArray(reportsTable.projectId, projectFilter)).orderBy(desc(reportsTable.reportDate)).limit(5)
    : await db.select({
        id: reportsTable.id, projectId: reportsTable.projectId,
        type: reportsTable.type, reportDate: reportsTable.reportDate,
        progressPercentage: reportsTable.progressPercentage,
      }).from(reportsTable).orderBy(desc(reportsTable.reportDate)).limit(5);

  const countByStatus = (status: string) => {
    const found = statusCounts.find(s => s.status === status);
    return found ? Number(found.cnt) : 0;
  };

  const activityCountByStatus = (status: string) => {
    const found = activityCounts.find(a => a.status === status);
    return found ? Number(found.cnt) : 0;
  };

  const today = new Date();

  const allActivities = allProjects.length > 0
    ? await db.select().from(activitiesTable).where(
        inArray(activitiesTable.projectId, allProjects.map(p => p.id))
      )
    : [];

  const activitiesByProject = new Map<number, typeof allActivities>();
  for (const a of allActivities) {
    const list = activitiesByProject.get(a.projectId) ?? [];
    list.push(a);
    activitiesByProject.set(a.projectId, list);
  }

  const projectsWithPlanned = allProjects.map(p => {
    const startDate = new Date(p.startDate);
    const endDate = new Date(p.expectedEndDate);
    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const projActivities = activitiesByProject.get(p.id) ?? [];
    const plannedProgress = Math.round(calcPlannedProgressForProject(projActivities, daysElapsed, totalDays));
    return {
      id: p.id,
      name: p.name,
      overallProgress: p.overallProgress,
      plannedProgress,
      status: p.status,
      daysRemaining,
      ownerEntity: p.ownerEntity,
      startDate: p.startDate,
      expectedEndDate: p.expectedEndDate,
    };
  });

  res.json({
    totalProjects: Number(totals?.total ?? 0),
    activeProjects: countByStatus("active"),
    completedProjects: countByStatus("completed"),
    delayedProjects: countByStatus("delayed"),
    suspendedProjects: countByStatus("suspended"),
    averageProgress: Math.round(Number(totals?.avgProgress ?? 0)),
    totalReports: Number(reportCount?.count ?? 0),
    totalActivities: activityCounts.reduce((s, a) => s + Number(a.cnt), 0),
    completedActivities: activityCountByStatus("completed"),
    delayedActivities: activityCountByStatus("delayed"),
    inProgressActivities: activityCountByStatus("in_progress"),
    recentProjects,
    allProjects: projectsWithPlanned,
    recentReports,
  });
});

router.get("/projects/:projectId/summary", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
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
  const suspensions = await db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));

  const today = new Date();
  const startDate = new Date(project.startDate);
  const endDate = new Date(project.expectedEndDate);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays);
  const delayDays = calcDelayDays(plannedProgress, project.overallProgress, totalDays);
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const netDelayDays = Math.max(0, delayDays - suspensionDays);

  res.json({
    projectId,
    overallProgress: project.overallProgress,
    plannedProgress: Math.round(plannedProgress * 100) / 100,
    activitiesTotal: activities.length,
    activitiesCompleted: activities.filter(a => a.status === "completed").length,
    activitiesDelayed: activities.filter(a => a.status === "delayed").length,
    daysElapsed,
    totalDays,
    daysRemaining,
    delayDays,
    suspensionDays,
    netDelayDays,
    reportsCount: Number(reportCount?.count ?? 0),
    filesCount: Number(fileCount?.count ?? 0),
  });
});

router.get("/projects/:projectId/deviation", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  const suspensions = await db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));

  const today = new Date();
  const startDate = new Date(project.startDate);
  const endDate = new Date(project.expectedEndDate);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays);

  const progressDeviation = project.overallProgress - plannedProgress;
  const timeDeviation = progressDeviation < -10 ? (plannedProgress - project.overallProgress) / 100 * totalDays : 0;
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const grossDelayDays = calcDelayDays(plannedProgress, project.overallProgress, totalDays);
  const netDelayDays = Math.max(0, grossDelayDays - suspensionDays);

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
    suspensionDays,
    grossDelayDays,
    netDelayDays,
    status: overallStatus,
    activitiesAnalysis,
  });
});

export default router;
