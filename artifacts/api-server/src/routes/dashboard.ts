import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectSuspensionsTable, projectMembersTable } from "@workspace/db";
import { eq, count, avg, sql, desc, asc, inArray } from "drizzle-orm";
import { requireStaffOrContractor, requireProjectAccess } from "../middlewares/auth";
import { resolveLinkedActivityProgress } from "../lib/external-sources";
import {
  calcPlannedProgressForProject,
  calcActualProgressForProject,
  calcDelayDays,
  calcActivityPlannedProgress,
  calcOverrunDays,
  calcSPI,
  calcForecastCompletionDate,
  calcExpectedProgressAtEnd,
  isActivityDelayed,
  roundPercent,
  type PlannedCurve,
  hasValidProjectSchedule,
  utcDay,
  utcDayDifference,
} from "../lib/progress";

const router: IRouter = Router();

type ActivitySnapshotItem = {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  plannedProgress: number;
  actualProgress: number;
  weight: number;
  externalSourceGroupId: number | null;
  actualRecordedAt: string | null;
  plannedHistoricalUnverified: boolean;
};

function parseActivitiesSnapshot(raw: unknown): ActivitySnapshotItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ActivitySnapshotItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    out.push({
      plannedStartDate: typeof o.plannedStartDate === "string" ? o.plannedStartDate : null,
      plannedEndDate: typeof o.plannedEndDate === "string" ? o.plannedEndDate : null,
      plannedProgress: typeof o.plannedProgress === "number" ? o.plannedProgress : 0,
      actualProgress: typeof o.actualProgress === "number" ? o.actualProgress : 0,
      weight: typeof o.weight === "number" && o.weight > 0 ? o.weight : 1,
      externalSourceGroupId: typeof o.externalSourceGroupId === "number" ? o.externalSourceGroupId : null,
      actualRecordedAt: typeof o.actualRecordedAt === "string" ? o.actualRecordedAt : null,
      plannedHistoricalUnverified: o.plannedHistoricalUnverified === true,
    });
  }
  return out;
}

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

  const safeRecentProjects = recentProjects.map(({ linkCode: _linkCode, ...project }) => {
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

  // Fan out the 5 reads in parallel — they're fully independent. Serially
  // each round-trip stacked on top of the prior one, making the summary
  // endpoint feel sluggish on the project overview page.
  const [
    [project],
    activities,
    [reportCount],
    [fileCount],
    suspensions,
  ] = await Promise.all([
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)),
    db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId)),
    db.select({ count: count() }).from(reportsTable).where(eq(reportsTable.projectId, projectId)),
    db.select({ count: count() }).from(projectFilesTable).where(eq(projectFilesTable.projectId, projectId)),
    db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId)),
  ]);

  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const today = utcDay(new Date());
  const resolvedActivities = await resolveLinkedActivityProgress(activities, today);
  const isNoSchedule = project.noSchedule === true;
  const hasSchedule = !isNoSchedule && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  const startDate = hasSchedule ? new Date(project.startDate!) : null;
  const totalDays = hasSchedule ? Math.max(1, utcDayDifference(project.expectedEndDate!, project.startDate!)) : 0;
  const daysElapsed = hasSchedule ? Math.max(0, utcDayDifference(today, startDate!)) : 0;
  const daysRemaining = hasSchedule ? Math.max(0, totalDays - daysElapsed) : 0;
  const plannedRaw = hasSchedule
    ? calcPlannedProgressForProject(resolvedActivities, daysElapsed, totalDays, today)
    : 0;
  const actualRaw = resolvedActivities.length > 0
    ? calcActualProgressForProject(resolvedActivities)
    : (project.overallProgress ?? 0);
  const actualProgressForSummary = roundPercent(actualRaw);
  const delayDays = hasSchedule ? calcDelayDays(plannedRaw, actualRaw, totalDays) : 0;
  const suspensionDays = hasSchedule
    ? suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0)
    : 0;
  // Net delay is gross delay minus suspension days, but only if gross delay exists.
  // Also ensuring we don't double count if schedule was already shifted.
  const netDelayDays = Math.max(0, delayDays - suspensionDays);
  const overrunDays = hasSchedule ? calcOverrunDays(today, project.expectedEndDate, actualRaw) : 0;

  res.json({
    projectId,
    noSchedule: isNoSchedule,
    overallProgress: actualProgressForSummary,
    plannedProgress: roundPercent(plannedRaw),
    spi: hasSchedule ? calcSPI(plannedRaw, actualRaw) : null,
    activitiesTotal: resolvedActivities.length,
    activitiesCompleted: resolvedActivities.filter(a => a.status === "completed").length,
    activitiesDelayed: resolvedActivities.filter(a => isActivityDelayed(a, today, !hasSchedule)).length,
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
  const curveParam = (Array.isArray(req.query.curve) ? req.query.curve[0] : req.query.curve) as string | undefined;
  const curve: PlannedCurve = curveParam === "scurve" ? "scurve" : "linear";

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id));
  const today = utcDay(new Date());
  const resolvedActivities = await resolveLinkedActivityProgress(activities, today, curve);
  const suspensions = await db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));

  const isNoSchedule = project.noSchedule === true;

  if (isNoSchedule) {
    const actualRaw = resolvedActivities.length > 0
      ? calcActualProgressForProject(resolvedActivities)
      : (project.overallProgress ?? 0);
    const activitiesAnalysis = resolvedActivities.map(a => ({
      activityId: a.id,
      activityName: a.name,
      plannedProgress: 0,
      actualProgress: a.actualProgress,
      deviation: 0,
      weight: a.weight ?? 1,
      weightedImpact: 0,
      delayDays: null,
      overrunDays: null,
    }));

    res.json({
      projectId,
      noSchedule: true,
      timeDeviation: 0,
      progressDeviation: 0,
      plannedProgress: 0,
      actualProgress: roundPercent(actualRaw),
      suspensionDays: 0,
      grossDelayDays: 0,
      netDelayDays: 0,
      overrunDays: 0,
      spi: null,
      forecastCompletionDate: null,
      expectedProgressAtEnd: 0,
      contractEndDate: project.expectedEndDate ?? null,
      forecastDelayDays: 0,
      suspensionsBreakdown: [],
      recommendations: [],
      status: "on_track",
      activitiesAnalysis,
    });
    return;
  }

  const hasSchedule = !isNoSchedule && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  const startDate = hasSchedule ? new Date(project.startDate!) : today;
  const endDate = hasSchedule ? new Date(project.expectedEndDate!) : today;
  const totalDays = hasSchedule ? Math.max(1, utcDayDifference(endDate, startDate)) : 0;
  const daysElapsed = hasSchedule ? Math.max(0, utcDayDifference(today, startDate)) : 0;
  const plannedRaw = hasSchedule
    ? calcPlannedProgressForProject(resolvedActivities, daysElapsed, totalDays, today, curve)
    : 0;
  const plannedProgress = roundPercent(plannedRaw);
  const actualRaw = resolvedActivities.length > 0
    ? calcActualProgressForProject(resolvedActivities)
    : (project.overallProgress ?? 0);
  const actualProgress = roundPercent(actualRaw);

  const progressDeviation = hasSchedule ? actualRaw - plannedRaw : 0;
  const timeDeviation = hasSchedule ? Math.max(0, plannedRaw - actualRaw) / 100 * totalDays : 0;
  const suspensionDays = hasSchedule ? suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0) : 0;
  const grossDelayDays = hasSchedule ? calcDelayDays(plannedRaw, actualRaw, totalDays) : 0;
  const netDelayDays = Math.max(0, grossDelayDays - suspensionDays);
  const overrunDays = hasSchedule ? calcOverrunDays(today, project.expectedEndDate, actualRaw) : 0;

  const spi = hasSchedule ? calcSPI(plannedRaw, actualRaw) : null;
  const forecastCompletion = hasSchedule
    ? calcForecastCompletionDate(startDate, endDate, today, plannedRaw, actualRaw)
    : null;
  const forecastCompletionDate = forecastCompletion ? forecastCompletion.toISOString().slice(0, 10) : null;
  const expectedProgressAtEnd = hasSchedule ? roundPercent(calcExpectedProgressAtEnd(plannedRaw, actualRaw)) : 0;
  const forecastDelayDays = forecastCompletion && project.expectedEndDate
    ? Math.ceil((forecastCompletion.getTime() - new Date(project.expectedEndDate).getTime()) / 86400000)
    : 0;

  const breakdownMap: Record<string, { days: number; count: number }> = {
    official_holiday: { days: 0, count: 0 },
    force_majeure: { days: 0, count: 0 },
    contractor_delay: { days: 0, count: 0 },
  };
  for (const s of suspensions) {
    const b = breakdownMap[s.type];
    if (b) {
      b.days += s.calendarDays;
      b.count += 1;
    }
  }
  const suspensionsBreakdown = Object.entries(breakdownMap)
    .map(([type, v]) => ({ type, days: v.days, count: v.count }))
    .filter(b => b.count > 0);

  let overallStatus: "on_track" | "slightly_delayed" | "significantly_delayed" | "ahead";
  if (!hasSchedule) {
    overallStatus = "on_track";
  } else
  if (progressDeviation > 5) {
    overallStatus = "ahead";
  } else if (progressDeviation >= -5) {
    overallStatus = "on_track";
  } else if (progressDeviation >= -15) {
    overallStatus = "slightly_delayed";
  } else {
    overallStatus = "significantly_delayed";
  }

  const totalWeight = resolvedActivities.reduce((s, a) => s + (a.weight && a.weight > 0 ? a.weight : 1), 0) || 1;
  const activitiesAnalysis = resolvedActivities.map(a => {
    const actPlannedRaw = hasSchedule ? calcActivityPlannedProgress(a, today, curve) : 0;
    const actPlanned = roundPercent(actPlannedRaw);
    const deviation = roundPercent(hasSchedule ? a.actualProgress - actPlannedRaw : 0);
    const w = a.weight && a.weight > 0 ? a.weight : 1;
    const weightedImpact = roundPercent(deviation * w / totalWeight);
    const overrun: number | null = a.plannedEndDate
      ? calcOverrunDays(today, a.plannedEndDate, a.actualProgress)
      : null;

    return {
      activityId: a.id,
      activityName: a.name,
      plannedProgress: actPlanned,
      actualProgress: roundPercent(a.actualProgress),
      deviation,
      weight: w,
      weightedImpact,
      delayDays: overrun,
      overrunDays: overrun,
    };
  });

  const criticalActs = activitiesAnalysis.filter(a => a.deviation < -10);
  const criticalPathStatus: "healthy" | "at_risk" | "critical" =
    criticalActs.length === 0 ? "healthy"
    : criticalActs.length <= 2 ? "at_risk"
    : "critical";

  // Auto recommendations
  const recommendations: { severity: "info" | "warning" | "critical"; title: string; description: string }[] = [];
  if (overallStatus === "significantly_delayed") {
    recommendations.push({
      severity: "critical",
      title: "انحراف كبير يستوجب تدخلاً عاجلاً",
      description: `المشروع متأخر بنسبة ${Math.abs(progressDeviation).toFixed(1)}% عن الخطة (${netDelayDays} يوم صافي). ينصح بمراجعة الجدول الزمني وطلب تمديد رسمي إن لزم.`,
    });
  } else if (overallStatus === "slightly_delayed") {
    recommendations.push({
      severity: "warning",
      title: "انحراف بسيط يمكن تداركه",
      description: `هناك تأخر بسيط بنسبة ${Math.abs(progressDeviation).toFixed(1)}%. يمكن تعويضه بتكثيف العمل خلال الأسابيع القادمة.`,
    });
  }
  if (criticalActs.length > 0) {
    recommendations.push({
      severity: criticalActs.length >= 3 ? "critical" : "warning",
      title: `${criticalActs.length} بند${criticalActs.length === 1 ? "" : criticalActs.length === 2 ? "ان" : ""} حرج${criticalActs.length === 1 ? "" : "ة"} متأخر${criticalActs.length === 1 ? "" : "ة"}`,
      description: `يجب تكثيف العمل في: ${criticalActs.slice(0, 3).map(a => a.activityName).join("، ")}${criticalActs.length > 3 ? "، وغيرها" : ""}.`,
    });
  }
  if (forecastDelayDays > 0 && project.expectedEndDate) {
    recommendations.push({
      severity: forecastDelayDays > 30 ? "critical" : "warning",
      title: "تاريخ الإكمال المتوقع متأخر عن التعاقدي",
      description: `بناءً على المعدل الحالي، يُتوقع إنجاز المشروع بعد ${forecastDelayDays} يوم${forecastDelayDays === 1 ? "" : "اً"} من الموعد التعاقدي.`,
    });
  } else if (forecastDelayDays < 0 && project.expectedEndDate) {
    recommendations.push({
      severity: "info",
      title: "إنجاز مبكر متوقع",
      description: `يُتوقع إنجاز المشروع قبل موعده التعاقدي بـ ${Math.abs(forecastDelayDays)} يوم.`,
    });
  }
  if (suspensionDays > 0) {
    recommendations.push({
      severity: "info",
      title: "خصم أيام التوقف من الانحراف",
      description: `تم خصم ${suspensionDays} يوم توقف معتمد، مما خفّض الانحراف من ${grossDelayDays} يوم إلى ${netDelayDays} يوم صافي.`,
    });
  }
  if (overallStatus === "ahead") {
    recommendations.push({
      severity: "info",
      title: "المشروع متقدم عن الخطة",
      description: `تقدم بنسبة ${progressDeviation.toFixed(1)}% عن المخطط. حافظ على هذا الأداء واحرص على ضبط الجودة.`,
    });
  }

  res.json({
    projectId,
    noSchedule: false,
    timeDeviation,
    progressDeviation: roundPercent(progressDeviation),
    plannedProgress: roundPercent(plannedProgress),
    actualProgress,
    suspensionDays,
    grossDelayDays,
    netDelayDays,
    overrunDays,
    spi,
    forecastCompletionDate,
    expectedProgressAtEnd,
    contractEndDate: project.expectedEndDate ?? null,
    forecastDelayDays,
    suspensionsBreakdown,
    recommendations,
    status: overallStatus,
    criticalPathStatus,
    activitiesAnalysis,
  });
});

router.get("/projects/:projectId/deviation/timeline", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const curveParam = (Array.isArray(req.query.curve) ? req.query.curve[0] : req.query.curve) as string | undefined;
  const curve: PlannedCurve = curveParam === "scurve" ? "scurve" : "linear";

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const suspensions = await db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));
  const suspBreakdownMap: Record<string, { days: number; count: number }> = {
    official_holiday: { days: 0, count: 0 },
    force_majeure: { days: 0, count: 0 },
    contractor_delay: { days: 0, count: 0 },
  };
  for (const s of suspensions) {
    const b = suspBreakdownMap[s.type];
    if (b) {
      b.days += s.calendarDays;
      b.count += 1;
    }
  }
  const suspensionsBreakdown = Object.entries(suspBreakdownMap)
    .map(([type, v]) => ({ type, days: v.days, count: v.count }))
    .filter(b => b.count > 0);

  if (project.noSchedule === true) {
    res.json({ projectId, noSchedule: true, points: [], suspensionsBreakdown });
    return;
  }

  const reports = await db
    .select({
      reportDate: reportsTable.reportDate,
      progressPercentage: reportsTable.progressPercentage,
      activitiesSnapshot: reportsTable.activitiesSnapshot,
      createdAt: reportsTable.createdAt,
    })
    .from(reportsTable)
    .where(eq(reportsTable.projectId, projectId))
    .orderBy(asc(reportsTable.reportDate));

  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));

  if (!hasValidProjectSchedule(project.startDate, project.expectedEndDate)) {
    res.json({ projectId, noSchedule: false, points: [], suspensionsBreakdown, baselineStatus: "no_historical_baseline" });
    return;
  }
  const startDate = utcDay(project.startDate!);
  const endDate = utcDay(project.expectedEndDate!);
  const totalDays = Math.max(1, utcDayDifference(endDate, startDate));
  const today = utcDay(new Date());
  const resolvedActivities = await resolveLinkedActivityProgress(activities, today, curve);

  const points = reports.map(r => {
    const reportDate = utcDay(r.reportDate);
    const daysElapsed = Math.max(0, utcDayDifference(reportDate, startDate));
    const snapshot = parseActivitiesSnapshot(r.activitiesSnapshot);
    if (!Array.isArray(r.activitiesSnapshot)) {
      return {
        date: r.reportDate,
        plannedProgress: null,
        actualProgress: null,
        deviation: null,
        spi: null,
        baselineStatus: "no_historical_baseline" as const,
      };
    }
    if (snapshot.length === 0) {
      return {
        date: r.reportDate,
        plannedProgress: 0,
        actualProgress: 0,
        deviation: 0,
        spi: null,
        baselineStatus: "available" as const,
      };
    }
    const plannedHistoricalUnverified = snapshot.some(item => item.plannedHistoricalUnverified);
    const actualVerifiable = snapshot.every(item => {
      const recordedAt = item.actualRecordedAt ?? r.createdAt;
      if (!recordedAt) return false;
      const recordedDay = utcDay(recordedAt);
      return Number.isFinite(recordedDay.getTime()) && recordedDay.getTime() <= reportDate.getTime();
    });
    const plannedRaw = calcPlannedProgressForProject(snapshot, daysElapsed, totalDays, reportDate, curve);
    const actualRaw = calcActualProgressForProject(snapshot);
    const planned = plannedHistoricalUnverified ? null : roundPercent(plannedRaw);
    const actual = actualVerifiable ? roundPercent(actualRaw) : null;
    return {
      date: r.reportDate,
      plannedProgress: planned,
      actualProgress: actual,
      deviation: planned == null || actual == null ? null : roundPercent(actual - planned),
      spi: planned == null || actual == null ? null : calcSPI(plannedRaw, actualRaw),
      baselineStatus: !actualVerifiable
        ? "actual_unverified" as const
        : plannedHistoricalUnverified
          ? "planned_unverified" as const
          : "available" as const,
    };
  });

  // Prepend a baseline (project start) point so the chart begins at 0/0 instead
  // of jumping in mid-project at the date of the first report.
  const isoStart = startDate.toISOString().slice(0, 10);
  if (points.length === 0 || points[0].date !== isoStart) {
    points.unshift({ date: isoStart, plannedProgress: 0, actualProgress: 0, deviation: 0, spi: null, baselineStatus: "available" as const });
  }

  // Always append a "today" data point so the chart shows the current state.
  // Use the weighted actual from current activities (consistent with deviation page).
  if (today >= startDate) {
    const daysElapsed = Math.max(0, utcDayDifference(today, startDate));
    const plannedRaw = calcPlannedProgressForProject(resolvedActivities, daysElapsed, totalDays, today, curve);
    const actualRaw = resolvedActivities.length > 0
      ? calcActualProgressForProject(resolvedActivities)
      : (project.overallProgress ?? 0);
    const planned = roundPercent(plannedRaw);
    const actual = roundPercent(actualRaw);
    const isoToday = today.toISOString().slice(0, 10);
    const lastPoint = points[points.length - 1];
    if (points.length === 0 || lastPoint.date !== isoToday || lastPoint.baselineStatus !== "available") {
      points.push({
        date: isoToday,
        plannedProgress: planned,
        actualProgress: actual,
        deviation: roundPercent(actual - planned),
        spi: calcSPI(plannedRaw, actualRaw),
        baselineStatus: "available" as const,
      });
    }
  }

  res.json({ projectId, noSchedule: false, points, suspensionsBreakdown });
});

export default router;
