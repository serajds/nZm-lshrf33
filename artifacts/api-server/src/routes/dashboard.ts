import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectSuspensionsTable, projectMembersTable } from "@workspace/db";
import { eq, count, avg, sql, desc, inArray } from "drizzle-orm";
import { requireStaffOrContractor, requireProjectAccess } from "../middlewares/auth";
import { calcPlannedProgressForProject, calcDelayDays, calcActivityPlannedProgress } from "../lib/progress";

const router: IRouter = Router();

router.get("/dashboard/summary", requireStaffOrContractor, async (_req, res): Promise<void> => {
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
        ownerEntity: projectsTable.ownerEntity, noSchedule: projectsTable.noSchedule,
      }).from(projectsTable).where(inArray(projectsTable.id, projectFilter)).orderBy(desc(projectsTable.overallProgress))
    : await db.select({
        id: projectsTable.id, name: projectsTable.name,
        overallProgress: projectsTable.overallProgress, status: projectsTable.status,
        startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
        ownerEntity: projectsTable.ownerEntity, noSchedule: projectsTable.noSchedule,
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
  today.setHours(0, 0, 0, 0);

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

  const projectNameMap = new Map(allProjects.map(p => [p.id, p.name]));
  const noScheduleProjectIds = new Set(allProjects.filter(p => p.noSchedule === true).map(p => p.id));
  const delayedActivitiesList = allActivities
    .filter(a => {
      if (a.actualProgress >= 100) return false;
      if (noScheduleProjectIds.has(a.projectId)) return false;
      if (!a.plannedEndDate) return false;
      const plannedEnd = new Date(a.plannedEndDate);
      plannedEnd.setHours(0, 0, 0, 0);
      return today > plannedEnd;
    })
    .map(a => {
      const plannedEnd = new Date(a.plannedEndDate!);
      plannedEnd.setHours(0, 0, 0, 0);
      const delayDays = Math.ceil((today.getTime() - plannedEnd.getTime()) / 86400000);
      return {
        id: a.id,
        name: a.name,
        projectId: a.projectId,
        projectName: projectNameMap.get(a.projectId) ?? "",
        plannedEndDate: a.plannedEndDate,
        actualProgress: a.actualProgress,
        delayDays,
      };
    })
    .sort((a, b) => b.delayDays - a.delayDays)
    .slice(0, 10);

  const projectsWithPlanned = allProjects.map(p => {
    const isNoSchedule = p.noSchedule === true;
    if (isNoSchedule) {
      return {
        id: p.id,
        name: p.name,
        overallProgress: p.overallProgress,
        plannedProgress: 0,
        status: p.status,
        daysRemaining: 0,
        ownerEntity: p.ownerEntity,
        startDate: p.startDate,
        expectedEndDate: p.expectedEndDate,
        noSchedule: true,
        overrunDays: 0,
      };
    }
    const startDate = new Date(p.startDate ?? Date.now());
    const endDate = new Date(p.expectedEndDate ?? Date.now());
    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const projActivities = activitiesByProject.get(p.id) ?? [];
    const plannedProgress = Math.round(calcPlannedProgressForProject(projActivities, daysElapsed, totalDays));
    const overrunDays = p.overallProgress < 100
      ? Math.max(0, Math.ceil((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
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
      noSchedule: false,
      overrunDays,
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
    delayedActivitiesList,
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

  const isNoSchedule = project.noSchedule === true;

  if (isNoSchedule) {
    res.json({
      projectId,
      noSchedule: true,
      overallProgress: project.overallProgress,
      plannedProgress: 0,
      activitiesTotal: activities.length,
      activitiesCompleted: activities.filter(a => a.status === "completed").length,
      activitiesDelayed: 0,
      daysElapsed: 0,
      totalDays: 0,
      daysRemaining: 0,
      delayDays: 0,
      suspensionDays: 0,
      netDelayDays: 0,
      overrunDays: 0,
      reportsCount: Number(reportCount?.count ?? 0),
      filesCount: Number(fileCount?.count ?? 0),
    });
    return;
  }

  const today = new Date();
  const startDate = new Date(project.startDate ?? Date.now());
  const endDate = new Date(project.expectedEndDate ?? Date.now());
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);
  const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays);
  const delayDays = calcDelayDays(plannedProgress, project.overallProgress, totalDays);
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const netDelayDays = Math.max(0, delayDays - suspensionDays);
  const overrunDays = project.overallProgress < 100
    ? Math.max(0, Math.ceil((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

  res.json({
    projectId,
    noSchedule: false,
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
    overrunDays,
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

  const isNoSchedule = project.noSchedule === true;

  if (isNoSchedule) {
    const activitiesAnalysis = activities.map(a => ({
      activityId: a.id,
      activityName: a.name,
      plannedProgress: 0,
      actualProgress: a.actualProgress,
      deviation: 0,
      delayDays: null,
      overrunDays: null,
    }));

    res.json({
      projectId,
      noSchedule: true,
      timeDeviation: 0,
      progressDeviation: 0,
      suspensionDays: 0,
      grossDelayDays: 0,
      netDelayDays: 0,
      overrunDays: 0,
      status: "on_track",
      activitiesAnalysis,
    });
    return;
  }

  const today = new Date();
  const startDate = new Date(project.startDate ?? Date.now());
  const endDate = new Date(project.expectedEndDate ?? Date.now());
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays);

  const progressDeviation = project.overallProgress - plannedProgress;
  const timeDeviation = progressDeviation < -10 ? (plannedProgress - project.overallProgress) / 100 * totalDays : 0;
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const grossDelayDays = calcDelayDays(plannedProgress, project.overallProgress, totalDays);
  const netDelayDays = Math.max(0, grossDelayDays - suspensionDays);
  const overrunDays = project.overallProgress < 100
    ? Math.max(0, Math.ceil((today.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;

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
    const actPlanned = Math.round(calcActivityPlannedProgress(a, today) * 100) / 100;
    const deviation = Math.round((a.actualProgress - actPlanned) * 100) / 100;
    let overrun: number | null = null;

    if (a.plannedEndDate) {
      if (a.actualProgress >= 100) {
        overrun = 0;
      } else {
        const plannedEnd = new Date(a.plannedEndDate);
        const diffDays = Math.ceil((today.getTime() - plannedEnd.getTime()) / (1000 * 60 * 60 * 24));
        overrun = Math.max(0, diffDays);
      }
    }

    return {
      activityId: a.id,
      activityName: a.name,
      plannedProgress: actPlanned,
      actualProgress: a.actualProgress,
      deviation,
      delayDays: overrun,
      overrunDays: overrun,
    };
  });

  res.json({
    projectId,
    noSchedule: false,
    timeDeviation,
    progressDeviation,
    suspensionDays,
    grossDelayDays,
    netDelayDays,
    overrunDays,
    status: overallStatus,
    activitiesAnalysis,
  });
});

export default router;
