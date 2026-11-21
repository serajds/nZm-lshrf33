import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, activityGroupsTable, reportsTable, projectFilesTable, projectExtensionsTable, projectSuspensionsTable, companiesTable } from "@workspace/db";
import { eq, and, count, desc, asc } from "drizzle-orm";
import { comparePassword, JWT_SECRET } from "../lib/auth";
import jwt from "jsonwebtoken";
import { resolveLinkedActivityProgress } from "../lib/external-sources";
import { getReportPeriodProgress, periodCutoff, validReportDay } from "../lib/report-period-progress";
import {
  calcPlannedProgressForProject,
  calcActualProgressForProject,
  calcDelayDays,
  calcOverrunDays,
  calcSPI,
  hasValidProjectSchedule,
  isActivityDelayed,
  roundPercent,
  utcDay,
  utcDayDifference,
} from "../lib/progress";

const router: IRouter = Router();
type OwnerReportHistoryReference = {
  id: number | null;
  actualProgress: number | null;
  plannedProgress: number | null;
  status: string | null;
  actualVerified: boolean;
  plannedVerified: boolean;
};

type SnapshotActivityForHistoryCheck = {
  id?: number;
  actualRecordedAt?: string | null;
  actualAsOfDate?: string | null;
  actualHistoricalUnverified?: boolean;
  actualManuallyApproved?: boolean;
  plannedAsOfDate?: string | null;
  plannedHistoricalUnverified?: boolean;
};

async function buildOwnerProjectData(project: typeof projectsTable.$inferSelect) {
  const rawActivities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, project.id))
    .orderBy(activitiesTable.sortOrder, activitiesTable.id);
  const today = utcDay(new Date());
  const activities = await resolveLinkedActivityProgress(rawActivities, today);
  const groups = await db.select({
    id: activityGroupsTable.id,
    name: activityGroupsTable.name,
    color: activityGroupsTable.color,
    sortOrder: activityGroupsTable.sortOrder,
  }).from(activityGroupsTable)
    .where(eq(activityGroupsTable.projectId, project.id))
    .orderBy(asc(activityGroupsTable.sortOrder), asc(activityGroupsTable.id));

  // The owner portal renders each report's activities table inline (and on
  // its print preview), so we MUST include `activitiesSnapshot` on every
  // row — that's the timeline as it was when the report was created. If
  // we ever switch to a slimmed projection here (the way the engineer-side
  // list endpoint does), the owner page will silently start showing the
  // CURRENT activities for old reports. Keep the full select.
  const reports = await db.select().from(reportsTable)
    .where(and(eq(reportsTable.projectId, project.id), eq(reportsTable.status, "approved")))
    .orderBy(desc(reportsTable.reportDate));

  // Older reports may have been created after their reporting period, before
  // per-activity history was attached to the report snapshot. Reconstruct
  // only those rows from the read-only period history; never write project or
  // report data while rendering the owner portal.
  const todayInTripoli = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const historyByPeriodEnd = new Map<string, ReturnType<typeof getReportPeriodProgress>>();
  const reportsWithHistoryReferences = await Promise.all(reports.map(async (report) => {
    const snapshot = Array.isArray(report.activitiesSnapshot)
      ? report.activitiesSnapshot as SnapshotActivityForHistoryCheck[]
      : null;
    if (!snapshot?.length) return report;

    const periodEnd = String(report.periodEnd).slice(0, 10);
    if (!validReportDay(periodEnd) || periodEnd >= todayInTripoli) return report;

    const cutoff = periodCutoff(periodEnd).getTime();
    const createdAt = new Date(report.createdAt).getTime();
    const needsHistoryReference = snapshot.some((activity) => {
      const actualRecordedAt = activity.actualRecordedAt
        ? new Date(activity.actualRecordedAt).getTime()
        : null;
      const actualAsOfDate = activity.actualAsOfDate?.slice(0, 10);
      const hasPeriodActual = actualAsOfDate
        ? actualAsOfDate === periodEnd
        : actualRecordedAt !== null && Number.isFinite(actualRecordedAt) && actualRecordedAt < cutoff;
      const actualRecordedAfterPeriod = actualRecordedAt !== null
        && Number.isFinite(actualRecordedAt)
        && actualRecordedAt >= cutoff;
      const actualNeedsHistory = activity.actualManuallyApproved !== true
        && (
          activity.actualHistoricalUnverified === true
          || (actualAsOfDate != null && actualAsOfDate !== periodEnd)
          || actualRecordedAfterPeriod
          || (!hasPeriodActual && createdAt >= cutoff)
        );
      const plannedNeedsHistory = activity.plannedHistoricalUnverified === true
        || (typeof activity.plannedAsOfDate === "string" && activity.plannedAsOfDate.slice(0, 10) !== periodEnd);
      return actualNeedsHistory || plannedNeedsHistory;
    });
    if (!needsHistoryReference) return report;

    let historyRequest = historyByPeriodEnd.get(periodEnd);
    if (!historyRequest) {
      historyRequest = getReportPeriodProgress(project.id, periodEnd);
      historyByPeriodEnd.set(periodEnd, historyRequest);
    }

    let activityHistoryReference: OwnerReportHistoryReference[] | null = null;
    try {
      const periodProgress = await historyRequest;
      if (Array.isArray(periodProgress.activities)) {
        const historicalById = new Map(periodProgress.activities.map((activity) => [activity.id, activity]));
        activityHistoryReference = snapshot.map((activity) => {
          const historical = typeof activity.id === "number" ? historicalById.get(activity.id) : undefined;
          const historicalWithFlags = historical as (typeof historical & {
            plannedHistoricalUnverified?: boolean;
            referenceOnly?: boolean;
          }) | undefined;
          return {
            id: typeof activity.id === "number" ? activity.id : null,
            actualProgress: historical?.actualProgress ?? null,
            plannedProgress: historical?.plannedProgress ?? null,
            status: historical?.status ?? null,
            actualVerified: Boolean(historical)
              && historical?.actualHistoricalUnverified !== true
              && historicalWithFlags?.referenceOnly !== true,
            plannedVerified: Boolean(historical)
              && historicalWithFlags?.plannedHistoricalUnverified !== true
              && historicalWithFlags?.referenceOnly !== true,
          };
        });
      }
    } catch (error) {
      console.error(`[owner] Could not load report-period activity history for project ${project.id}, report ${report.id}`, error);
    }

    return { ...report, activityHistoryReference };
  }));

  const extensions = await db.select().from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, project.id))
    .orderBy(projectExtensionsTable.extensionDate);

  const suspensions = await db.select().from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, project.id))
    .orderBy(projectSuspensionsTable.startDate);

  const isNoSchedule = project.noSchedule === true;
  const hasSchedule = !isNoSchedule && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  const [filesCountResult] = await db.select({ count: count() }).from(projectFilesTable).where(eq(projectFilesTable.projectId, project.id));
  const activitiesCompleted = activities.filter(a => a.status === "completed").length;

  interface OwnerSummary {
    projectId: number;
    noSchedule: boolean;
    overallProgress: number;
    plannedProgress: number;
    spi: number | null;
    activitiesTotal: number;
    activitiesCompleted: number;
    activitiesDelayed: number;
    daysElapsed: number;
    totalDays: number;
    daysRemaining: number;
    delayDays: number;
    suspensionDays: number;
    netDelayDays: number;
    overrunDays: number;
    reportsCount: number;
    filesCount: number | bigint;
  }

  let summary: OwnerSummary;

  const actualRaw = activities.length > 0
    ? calcActualProgressForProject(activities)
    : (project.overallProgress ?? 0);
  const computedActual = roundPercent(actualRaw);

  if (!hasSchedule) {
    summary = {
      projectId: project.id,
      noSchedule: isNoSchedule,
      overallProgress: computedActual,
      plannedProgress: 0,
      spi: null,
      activitiesTotal: activities.length,
      activitiesCompleted,
      activitiesDelayed: 0,
      daysElapsed: 0,
      totalDays: 0,
      daysRemaining: 0,
      delayDays: 0,
      suspensionDays: 0,
      netDelayDays: 0,
      overrunDays: 0,
      reportsCount: reports.length,
      filesCount: filesCountResult?.count ?? 0,
    };
  } else {
    const totalDays = Math.max(1, utcDayDifference(project.expectedEndDate!, project.startDate!));
    const daysElapsed = Math.max(0, utcDayDifference(today, project.startDate!));
    const rawDaysRemaining = utcDayDifference(project.expectedEndDate!, today);
    const daysRemaining = Math.max(0, rawDaysRemaining);
    const plannedRaw = calcPlannedProgressForProject(activities, daysElapsed, totalDays, today);
    const plannedProgress = roundPercent(plannedRaw);
    // انحراف عن الخطة (planned vs actual progress only)
    const delayDays = calcDelayDays(plannedRaw, actualRaw, totalDays);
    // تجاوز المدة (calendar overrun past expectedEndDate while not complete)
    const overrunDays = calcOverrunDays(today, project.expectedEndDate, actualRaw);
    const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
    const netDelayDays = Math.max(0, delayDays - suspensionDays);
    const activitiesDelayed = activities.filter(a => isActivityDelayed(a, today, false)).length;

    summary = {
      projectId: project.id,
      noSchedule: false,
      overallProgress: computedActual,
      plannedProgress,
      spi: calcSPI(plannedRaw, actualRaw),
      activitiesTotal: activities.length,
      activitiesCompleted,
      activitiesDelayed,
      daysElapsed,
      totalDays,
      daysRemaining,
      delayDays,
      suspensionDays,
      netDelayDays,
      overrunDays,
      reportsCount: reports.length,
      filesCount: filesCountResult?.count ?? 0,
    };
  }

  const companyLogos: Record<string, { name: string; logoUrl: string | null }> = {};
  const companyIds = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (companyIds.length > 0) {
    const companies = await db.select().from(companiesTable);
    for (const c of companies) {
      if (companyIds.includes(c.id)) {
        if (c.id === project.ownerCompanyId) companyLogos.owner = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.contractorCompanyId) companyLogos.contractor = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.supervisorCompanyId) companyLogos.supervisor = { name: c.name, logoUrl: c.logoUrl };
      }
    }
  }

  const { ownerAccessPassword: _, linkCode: _linkCode, parentProjectId: _parent, categoryId: _category, ...safeProject } = project;
  const safeActivities = activities.map(({
    externalSourceGroupId: _sourceGroupId,
    managedByGroupId: _managedByGroupId,
    managedSourceProjectId: _sourceProjectId,
    ...activity
  }) => activity);

  return { project: safeProject, activities: safeActivities, groups, reports: reportsWithHistoryReferences, extensions, suspensions, summary, companyLogos };
}

router.get("/owner/access/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح أو منتهي الصلاحية" });
    return;
  }

  const companyLogos: Record<string, { name: string; logoUrl: string | null }> = {};
  const companyIds = [project.ownerCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (companyIds.length > 0) {
    const companies = await db.select().from(companiesTable);
    for (const c of companies) {
      if (companyIds.includes(c.id)) {
        if (c.id === project.ownerCompanyId) companyLogos.owner = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.supervisorCompanyId) companyLogos.supervisor = { name: c.name, logoUrl: c.logoUrl };
      }
    }
  }

  res.json({ exists: true, projectName: project.name, hasPassword: !!project.ownerAccessPassword, companyLogos });
});

router.post("/owner/verify", async (req, res): Promise<void> => {
  const { token, password } = req.body;

  if (!token) {
    res.status(400).json({ error: "الرمز مطلوب" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح" });
    return;
  }

  if (project.ownerAccessPassword) {
    if (!password) {
      res.status(400).json({ error: "كلمة المرور مطلوبة" });
      return;
    }
    const valid = await comparePassword(password, project.ownerAccessPassword);
    if (!valid) {
      res.status(401).json({ error: "كلمة المرور غير صحيحة" });
      return;
    }
  }

  const ownerJwt = jwt.sign(
    { ownerToken: token, projectId: project.id },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const data = await buildOwnerProjectData(project);

  res.json({ ...data, ownerJwt });
});

router.get("/owner/:token/data", async (req, res): Promise<void> => {
  const { token } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as { ownerToken: string; projectId: number };
    if (decoded.ownerToken !== token) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }
  } catch {
    res.status(401).json({ error: "انتهت صلاحية الجلسة" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح" });
    return;
  }

  const data = await buildOwnerProjectData(project);
  res.json(data);
});

export default router;
