import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectSuspensionsTable, projectMembersTable } from "@workspace/db";
import { eq, count, avg, sql, desc, asc, inArray } from "drizzle-orm";
import { requireStaffOrContractor, requireProjectAccess } from "../middlewares/auth";
import {
  calcPlannedProgressForProject,
  calcActualProgressForProject,
  calcDelayDays,
  calcActivityPlannedProgress,
  calcOverrunDays,
  calcSPI,
  calcForecastCompletionDate,
  calcExpectedProgressAtEnd,
  type PlannedCurve,
} from "../lib/progress";

const router: IRouter = Router();

type ActivitySnapshotItem = {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualProgress: number;
  weight: number;
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
      actualProgress: typeof o.actualProgress === "number" ? o.actualProgress : 0,
      weight: typeof o.weight === "number" && o.weight > 0 ? o.weight : 1,
    });
  }
  return out;
}

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
    const overrunDays = calcOverrunDays(today, p.expectedEndDate, p.overallProgress);
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
  const overrunDays = calcOverrunDays(today, project.expectedEndDate, project.overallProgress);

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
  const curveParam = (Array.isArray(req.query.curve) ? req.query.curve[0] : req.query.curve) as string | undefined;
  const curve: PlannedCurve = curveParam === "scurve" ? "scurve" : "linear";

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
      actualProgress: project.overallProgress,
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

  const today = new Date();
  const startDate = new Date(project.startDate ?? Date.now());
  const endDate = new Date(project.expectedEndDate ?? Date.now());
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays, today, curve);
  const actualProgress = activities.length > 0
    ? Math.round(calcActualProgressForProject(activities) * 100) / 100
    : project.overallProgress;

  const progressDeviation = actualProgress - plannedProgress;
  const timeDeviation = progressDeviation < -10 ? (plannedProgress - actualProgress) / 100 * totalDays : 0;
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const grossDelayDays = calcDelayDays(plannedProgress, actualProgress, totalDays);
  const netDelayDays = Math.max(0, grossDelayDays - suspensionDays);
  const overrunDays = calcOverrunDays(today, project.expectedEndDate, actualProgress);

  const spi = calcSPI(plannedProgress, actualProgress);
  const forecastCompletion = calcForecastCompletionDate(startDate, today, actualProgress);
  const forecastCompletionDate = forecastCompletion ? forecastCompletion.toISOString().slice(0, 10) : null;
  const expectedProgressAtEnd = Math.round(calcExpectedProgressAtEnd(startDate, endDate, today, actualProgress) * 100) / 100;
  const forecastDelayDays = forecastCompletion && project.expectedEndDate
    ? Math.max(0, Math.ceil((forecastCompletion.getTime() - new Date(project.expectedEndDate).getTime()) / 86400000))
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
  if (progressDeviation > 5) {
    overallStatus = "ahead";
  } else if (progressDeviation >= -5) {
    overallStatus = "on_track";
  } else if (progressDeviation >= -15) {
    overallStatus = "slightly_delayed";
  } else {
    overallStatus = "significantly_delayed";
  }

  const totalWeight = activities.reduce((s, a) => s + (a.weight && a.weight > 0 ? a.weight : 1), 0) || 1;
  const activitiesAnalysis = activities.map(a => {
    const actPlanned = Math.round(calcActivityPlannedProgress(a, today, curve) * 100) / 100;
    const deviation = Math.round((a.actualProgress - actPlanned) * 100) / 100;
    const w = a.weight && a.weight > 0 ? a.weight : 1;
    const weightedImpact = Math.round((deviation * w / totalWeight) * 100) / 100;
    const overrun: number | null = a.plannedEndDate
      ? calcOverrunDays(today, a.plannedEndDate, a.actualProgress)
      : null;

    return {
      activityId: a.id,
      activityName: a.name,
      plannedProgress: actPlanned,
      actualProgress: a.actualProgress,
      deviation,
      weight: w,
      weightedImpact,
      delayDays: overrun,
      overrunDays: overrun,
    };
  });

  // Auto recommendations
  const recommendations: { severity: "info" | "warning" | "critical"; title: string; description: string }[] = [];
  const criticalActs = activitiesAnalysis.filter(a => a.deviation < -10);
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
  }
  if (suspensionDays > 0) {
    recommendations.push({
      severity: "info",
      title: "خصم أيام التوقف من الانحراف",
      description: `تم خصم ${suspensionDays} يوم توقف معتمد، مما خفّض الانحراف من ${grossDelayDays} يوم إلى ${netDelayDays} يوم صافي.`,
    });
  }
  if (overallStatus === "on_track") {
    recommendations.push({
      severity: "info",
      title: "المشروع على المسار الصحيح",
      description: "حافظ على نفس وتيرة العمل الحالية ومراقبة البنود الحرجة باستمرار.",
    });
  } else if (overallStatus === "ahead") {
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
    progressDeviation: Math.round(progressDeviation * 100) / 100,
    plannedProgress: Math.round(plannedProgress * 100) / 100,
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
    })
    .from(reportsTable)
    .where(eq(reportsTable.projectId, projectId))
    .orderBy(asc(reportsTable.reportDate));

  const activities = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));

  const startDate = new Date(project.startDate ?? Date.now());
  const endDate = new Date(project.expectedEndDate ?? Date.now());
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000));

  const points = reports.map(r => {
    const reportDate = new Date(r.reportDate);
    const daysElapsed = Math.max(0, Math.ceil((reportDate.getTime() - startDate.getTime()) / 86400000));
    const snapshot = parseActivitiesSnapshot(r.activitiesSnapshot);
    const activitiesForCalc = snapshot.length > 0 ? snapshot : activities;
    const planned = Math.round(calcPlannedProgressForProject(activitiesForCalc, daysElapsed, totalDays, reportDate, curve) * 100) / 100;
    const actual = Math.round((r.progressPercentage ?? 0) * 100) / 100;
    return {
      date: r.reportDate,
      plannedProgress: planned,
      actualProgress: actual,
      deviation: Math.round((actual - planned) * 100) / 100,
    };
  });

  // Always append a "today" data point so the chart shows the current state
  const today = new Date();
  if (today >= startDate) {
    const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / 86400000));
    const planned = Math.round(calcPlannedProgressForProject(activities, daysElapsed, totalDays, today, curve) * 100) / 100;
    const actual = Math.round(project.overallProgress * 100) / 100;
    const isoToday = today.toISOString().slice(0, 10);
    if (points.length === 0 || points[points.length - 1].date !== isoToday) {
      points.push({
        date: isoToday,
        plannedProgress: planned,
        actualProgress: actual,
        deviation: Math.round((actual - planned) * 100) / 100,
      });
    }
  }

  res.json({ projectId, noSchedule: false, points, suspensionsBreakdown });
});

export default router;
