import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectSuspensionsTable, projectMembersTable } from "@workspace/db";
import { eq, count, avg, sql, desc, inArray } from "drizzle-orm";
import { requireStaffOrContractor, requireProjectAccess } from "../middlewares/auth";
import { resolveLinkedActivityProgress } from "../lib/external-sources";
import { loadEffectiveTabPermissions } from "../middlewares/tab-access";
import { getDeviationAnalysis, getDeviationTimeline, getProjectAnalysisSnapshot } from "../lib/deviation-service";
import {
  calcPlannedProgressForProject,
  calcActualProgressForProject,
  calcDelayDays,
  calcOverrunDays,
  calcSPI,
  isActivityDelayed,
  roundPercent,
  type PlannedCurve,
  hasValidProjectSchedule,
  utcDay,
  utcDayDifference,
} from "../lib/progress";

const router: IRouter = Router();

router.get("/dashboard/summary", requireStaffOrContractor, async (_req, res): Promise<void> => {
  const today = utcDay(new Date());
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

  // Run all 7 independent reads concurrently. They were previously
  // serialized — turning the dashboard load into ~7× the necessary latency.
  const [
    totalsRows,
    statusCounts,
    reportCountRows,
    activityCounts,
    recentProjects,
    allProjects,
    recentReports,
  ] = await Promise.all([
    projectFilter
      ? db.select({
          total: count(),
          avgProgress: avg(projectsTable.overallProgress),
        }).from(projectsTable).where(inArray(projectsTable.id, projectFilter))
      : db.select({
          total: count(),
          avgProgress: avg(projectsTable.overallProgress),
        }).from(projectsTable),
    projectFilter
      ? db.select({ status: projectsTable.status, cnt: count() })
          .from(projectsTable).where(inArray(projectsTable.id, projectFilter)).groupBy(projectsTable.status)
      : db.select({ status: projectsTable.status, cnt: count() })
          .from(projectsTable).groupBy(projectsTable.status),
    projectFilter
      ? db.select({ count: count() }).from(reportsTable).where(inArray(reportsTable.projectId, projectFilter))
      : db.select({ count: count() }).from(reportsTable),
    projectFilter
      ? db.select({ status: activitiesTable.status, cnt: count() })
          .from(activitiesTable).where(inArray(activitiesTable.projectId, projectFilter)).groupBy(activitiesTable.status)
      : db.select({ status: activitiesTable.status, cnt: count() })
          .from(activitiesTable).groupBy(activitiesTable.status),
    projectFilter
      ? db.select().from(projectsTable)
          .where(inArray(projectsTable.id, projectFilter))
          .orderBy(sql`${projectsTable.updatedAt} DESC`).limit(8)
      : db.select().from(projectsTable)
          .orderBy(sql`${projectsTable.updatedAt} DESC`).limit(8),
    projectFilter
      ? db.select({
          id: projectsTable.id, name: projectsTable.name,
          overallProgress: projectsTable.overallProgress, status: projectsTable.status,
          startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
          ownerEntity: projectsTable.ownerEntity, noSchedule: projectsTable.noSchedule,
        }).from(projectsTable).where(inArray(projectsTable.id, projectFilter)).orderBy(desc(projectsTable.overallProgress))
      : db.select({
          id: projectsTable.id, name: projectsTable.name,
          overallProgress: projectsTable.overallProgress, status: projectsTable.status,
          startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
          ownerEntity: projectsTable.ownerEntity, noSchedule: projectsTable.noSchedule,
        }).from(projectsTable).orderBy(desc(projectsTable.overallProgress)),
    projectFilter
      ? db.select({
          id: reportsTable.id, projectId: reportsTable.projectId,
          type: reportsTable.type, reportDate: reportsTable.reportDate,
          progressPercentage: reportsTable.progressPercentage,
        }).from(reportsTable).where(inArray(reportsTable.projectId, projectFilter)).orderBy(desc(reportsTable.reportDate)).limit(5)
      : db.select({
          id: reportsTable.id, projectId: reportsTable.projectId,
          type: reportsTable.type, reportDate: reportsTable.reportDate,
          progressPercentage: reportsTable.progressPercentage,
      }).from(reportsTable).orderBy(desc(reportsTable.reportDate)).limit(5),
  ]);

  const [totals] = totalsRows;
  const [reportCount] = reportCountRows;
  // Project codes are capabilities and must never appear in dashboard lists.
  const countByStatus = (status: string) => {
    const found = statusCounts.find(s => s.status === status);
    return found ? Number(found.cnt) : 0;
  };

  const activityCountByStatus = (status: string) => {
    const found = activityCounts.find(a => a.status === status);
    return found ? Number(found.cnt) : 0;
  };

  const allActivities = allProjects.length > 0
    ? await db.select().from(activitiesTable).where(
        inArray(activitiesTable.projectId, allProjects.map(p => p.id))
      )
    : [];
  const resolvedActivities = await resolveLinkedActivityProgress(allActivities, today);

  const activitiesByProject = new Map<number, typeof resolvedActivities>();
  for (const a of resolvedActivities) {
    const list = activitiesByProject.get(a.projectId) ?? [];
    list.push(a);
    activitiesByProject.set(a.projectId, list);
  }

  const safeRecentProjects = recentProjects.map(({
    linkCode: _linkCode,
    ownerAccessToken: _ownerAccessToken,
    ownerAccessPassword: _ownerAccessPassword,
    parentProjectId: _portfolioParent,
    categoryId: _portfolioCategory,
    ...project
  }) => {
    const projectActivities = activitiesByProject.get(project.id) ?? [];
    const actualRaw = projectActivities.length > 0
      ? calcActualProgressForProject(projectActivities)
      : (project.overallProgress ?? 0);
    return { ...project, overallProgress: roundPercent(actualRaw) };
  });
  const projectNameMap = new Map(allProjects.map(p => [p.id, p.name]));
  const noScheduleProjectIds = new Set(allProjects.filter(p => p.noSchedule === true).map(p => p.id));
  const delayedActivitiesAll = resolvedActivities.filter(a =>
    isActivityDelayed(a, today, noScheduleProjectIds.has(a.projectId))
  );
  const delayedActivitiesCount = delayedActivitiesAll.length;
  const delayedActivitiesList = delayedActivitiesAll
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
    const hasSchedule = !isNoSchedule && hasValidProjectSchedule(p.startDate, p.expectedEndDate);
    const projActivities = activitiesByProject.get(p.id) ?? [];
    const actualRaw = projActivities.length > 0
      ? calcActualProgressForProject(projActivities)
      : (p.overallProgress ?? 0);
    const computedActual = roundPercent(actualRaw);
    if (!hasSchedule) {
      return {
        id: p.id,
        name: p.name,
        overallProgress: computedActual,
        plannedProgress: 0,
        spi: null,
        status: p.status,
        daysRemaining: 0,
        ownerEntity: p.ownerEntity,
        startDate: p.startDate,
        expectedEndDate: p.expectedEndDate,
        noSchedule: isNoSchedule,
        overrunDays: 0,
      };
    }
    const startDate = new Date(p.startDate!);
    const totalDays = Math.max(1, utcDayDifference(p.expectedEndDate!, p.startDate!));
    const daysElapsed = Math.max(0, utcDayDifference(today, startDate));
    const daysRemaining = Math.max(0, totalDays - daysElapsed);
    const plannedRaw = calcPlannedProgressForProject(projActivities, daysElapsed, totalDays, today);
    const plannedProgress = roundPercent(plannedRaw);
    const overrunDays = calcOverrunDays(today, p.expectedEndDate, computedActual);
    return {
      id: p.id,
      name: p.name,
      overallProgress: computedActual,
      plannedProgress,
      spi: calcSPI(plannedRaw, actualRaw),
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
    averageProgress: roundPercent(allProjects.length
      ? allProjects.reduce((sum, project) => {
          const projectActivities = activitiesByProject.get(project.id) ?? [];
          return sum + (projectActivities.length > 0
            ? calcActualProgressForProject(projectActivities)
            : (project.overallProgress ?? 0));
        }, 0) / allProjects.length
      : 0),
    totalReports: Number(reportCount?.count ?? 0),
    totalActivities: activityCounts.reduce((s, a) => s + Number(a.cnt), 0),
    completedActivities: activityCountByStatus("completed"),
    delayedActivities: delayedActivitiesCount,
    inProgressActivities: activityCountByStatus("in_progress"),
    recentProjects: safeRecentProjects,
    allProjects: projectsWithPlanned,
    recentReports,
    delayedActivitiesList,
  });
});

router.get("/projects/:projectId/summary", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  if (req.query.curve != null && req.query.curve !== "linear" && req.query.curve !== "scurve") {
    res.status(400).json({error:"منحنى التخطيط غير صالح"}); return;
  }

  const snapshot = await getProjectAnalysisSnapshot(projectId, req.user!.userId, req.query.curve === "scurve" ? "scurve" : "linear");
  if (!snapshot) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const {project,analysis:a,activities} = snapshot;
  const hasSchedule = !project.noSchedule && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  const totalDays = hasSchedule ? Math.max(1, utcDayDifference(project.expectedEndDate!, project.startDate!)) : 0;
  const daysElapsed = hasSchedule ? Math.max(0, utcDayDifference(a.asOfDate, project.startDate!)) : 0;
  const daysRemaining = hasSchedule ? Math.max(0, totalDays - daysElapsed) : 0;

  res.json({
    projectId,
    noSchedule: project.noSchedule,
    asOfDate:a.asOfDate, curve:a.curve, scheduleStatus:a.scheduleStatus,dataStatus:a.dataStatus,
    overallProgress: roundPercent(a.actualProgress),
    plannedProgress: a.plannedProgress==null?null:roundPercent(a.plannedProgress),
    progressDeviation:a.progressDeviation,spi:a.spi,
    forecastCompletionDate:a.forecastCompletionDate,forecastStatus:a.forecastStatus,
    forecastDelayDays:a.forecastDelayDays,
    activitiesTotal: activities.length,
    activitiesCompleted: activities.filter(a => a.status === "completed").length,
    activitiesDelayed: activities.filter(a => a.delayed).length,
    daysElapsed,
    totalDays,
    daysRemaining,
    delayDays:a.grossDelayDays==null?null:Math.round(a.grossDelayDays),
    suspensionDays:a.suspensionDays,
    netDelayDays:a.netDelayDays,
    overrunDays:a.overrunDays,
    reportsCount: snapshot.reportsCount,
    filesCount: snapshot.filesCount,
  });
});

router.get("/projects/:projectId/deviation", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const access = await loadEffectiveTabPermissions(req.user!.userId, projectId);
  if (!access || access.effective.deviation === "hidden") {
    res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا القسم" }); return;
  }
  const data = await getDeviationAnalysis(projectId, req.user!.userId, req.query.curve === "scurve" ? "scurve" : "linear");
  if (!data) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  res.json(data);
});

router.get("/projects/:projectId/deviation/timeline", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const access = await loadEffectiveTabPermissions(req.user!.userId, projectId);
  if (!access || access.effective.deviation === "hidden") {
    res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا القسم" }); return;
  }
  const data = await getDeviationTimeline(projectId, req.user!.userId, req.query.curve === "scurve" ? "scurve" : "linear");
  if (!data) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  res.json(data);
});

export default router;
