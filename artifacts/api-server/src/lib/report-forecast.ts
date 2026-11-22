import { asc, desc, eq } from "drizzle-orm";
import {
  activitiesTable,
  db,
  projectsTable,
  reportsTable,
} from "@workspace/db";
import { getGroupSummaries } from "./external-sources";
import { calcActivityPlannedProgress, hasValidProjectSchedule, roundPercent } from "./progress";
import { getReportPeriodProgress, type HistoricalActivity, validReportDay } from "./report-period-progress";

export type ForecastSnapshotActivity = {
  id: number;
  name: string;
  groupId: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  externalSourceGroupId: number | null;
  actualRecordedAt?: string;
  actualAsOfDate: string;
  actualHistoricalUnverified: boolean;
  plannedAsOfDate: string;
  plannedHistoricalUnverified: boolean;
  plannedProgress: number | null;
  actualProgress: number | null;
  weight: number;
  status: string;
  sortOrder: number;
  forecastStatus: string;
  actualStatus: string | null;
};

export type ReportForecastProgress = {
  forecastDraft: true;
  targetDate: string;
  today: string;
  actualAsOfDate: string;
  actualAvailable: boolean;
  actualProgress: number | null;
  plannedProgress: number | null;
  plannedSource: "project_schedule" | "unavailable";
  actualSource: "history" | "estimated_history" | "approved_report" | "unavailable";
  actualReportNumber: number | null;
  manualSuggestion: {
    reportNumber: number;
    progressPercentage: number;
    actualAsOfDate: string;
    reportDate: string;
  } | null;
  activities: ForecastSnapshotActivity[];
};

type CurrentActivity = {
  id: number;
  name: string;
  groupId: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  externalSourceGroupId: number | null;
  actualProgress: number;
  plannedProgress: number;
  weight: number;
  status: string;
  sortOrder: number;
};

function weighted(rows: Array<{ value: number; weight: number }>): number | null {
  if (!rows.length) return 0;
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    const weight = Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
    total += weight;
    sum += row.value * weight;
  }
  return total > 0 ? roundPercent(sum / total) : null;
}

function expectedStatus(activity: CurrentActivity, planned: number | null, day: string): string {
  if (planned === null) return "unknown";
  // This is a schedule expectation only. The displayed label is explicitly
  // identified as expected, never as observed completion.
  if (planned >= 100) return "completed";
  if (planned > 0) return "in_progress";
  if (activity.plannedStartDate && day < activity.plannedStartDate) return "not_started";
  return "not_started";
}

export function buildForecastActivities(
  currentActivities: CurrentActivity[],
  plannedById: Map<number, { value: number | null; verified: boolean }>,
  actualRows: HistoricalActivity[] | null,
  targetDate: string,
  actualAsOfDate: string,
): ForecastSnapshotActivity[] {
  const actualById = new Map((actualRows ?? [])
    .filter(row => typeof row.id === "number")
    .map(row => [row.id, row as HistoricalActivity & { actualRecordedAt?: string }]));
  return currentActivities.map(activity => {
    const planned = plannedById.get(activity.id) ?? { value: null, verified: false };
    const recorded = actualById.get(activity.id);
    const actualKnown = recorded != null
      && recorded.actualHistoricalUnverified !== true
      && recorded.actualHistoryEstimated !== true
      && typeof recorded.actualProgress === "number"
      && Number.isFinite(recorded.actualProgress);
    return {
      id: activity.id,
      name: activity.name,
      groupId: activity.groupId,
      plannedStartDate: activity.plannedStartDate,
      plannedEndDate: activity.plannedEndDate,
      actualStartDate: actualKnown ? recorded!.actualStartDate : null,
      actualEndDate: actualKnown ? recorded!.actualEndDate : null,
      externalSourceGroupId: activity.externalSourceGroupId,
      actualRecordedAt: actualKnown ? recorded!.actualRecordedAt : undefined,
      actualAsOfDate,
      actualHistoricalUnverified: !actualKnown,
      plannedAsOfDate: targetDate,
      plannedHistoricalUnverified: !planned.verified,
      plannedProgress: planned.value,
      actualProgress: actualKnown ? roundPercent(recorded!.actualProgress) : null,
      weight: activity.weight,
      status: targetDate > actualAsOfDate
        ? expectedStatus(activity, planned.value, targetDate)
        : actualKnown ? recorded!.status : expectedStatus(activity, planned.value, targetDate),
      forecastStatus: expectedStatus(activity, planned.value, targetDate),
      actualStatus: actualKnown ? recorded!.status : null,
      sortOrder: activity.sortOrder,
    };
  });
}

function currentTripoliDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function reportDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function getReportForecastProgress(
  projectId: number,
  targetDate: string,
  now = new Date(),
): Promise<ReportForecastProgress> {
  if (!validReportDay(targetDate)) throw new Error("تاريخ المسودة الاستشرافية غير صالح");
  const today = currentTripoliDay(now);
  const actualAsOfDate = targetDate > today ? today : targetDate;
  const [project] = await db.select({
    noSchedule: projectsTable.noSchedule,
    startDate: projectsTable.startDate,
    expectedEndDate: projectsTable.expectedEndDate,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) throw new Error("المشروع غير موجود");

  const currentActivities = await db.select({
    id: activitiesTable.id,
    name: activitiesTable.name,
    groupId: activitiesTable.groupId,
    plannedStartDate: activitiesTable.plannedStartDate,
    plannedEndDate: activitiesTable.plannedEndDate,
    actualStartDate: activitiesTable.actualStartDate,
    actualEndDate: activitiesTable.actualEndDate,
    externalSourceGroupId: activitiesTable.externalSourceGroupId,
    actualProgress: activitiesTable.actualProgress,
    plannedProgress: activitiesTable.plannedProgress,
    weight: activitiesTable.weight,
    status: activitiesTable.status,
    sortOrder: activitiesTable.sortOrder,
  }).from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id)) as CurrentActivity[];

  const asOf = new Date(`${targetDate}T00:00:00Z`);
  const linkedIds = currentActivities.flatMap(activity =>
    activity.externalSourceGroupId == null ? [] : [activity.externalSourceGroupId]);
  const linkedSummaries = linkedIds.length
    ? await getGroupSummaries(linkedIds, asOf)
    : new Map();
  const hasProjectSchedule = project.noSchedule !== true
    && hasValidProjectSchedule(project.startDate, project.expectedEndDate);

  // Forecast the plan from schedule dates and linked source schedules only.
  // Do not use live actualProgress/status as values for a future target.
  const planned = currentActivities.map(activity => {
    if (activity.externalSourceGroupId != null) {
      const source = linkedSummaries.get(activity.externalSourceGroupId);
      return hasProjectSchedule && source
        ? { activity, value: roundPercent(source.plannedProgress), verified: true }
        : { activity, value: null, verified: false };
    }
    const datesValid = Boolean(activity.plannedStartDate && activity.plannedEndDate);
    return {
      activity,
      value: hasProjectSchedule && datesValid
        ? roundPercent(calcActivityPlannedProgress(activity, asOf))
        : null,
      verified: hasProjectSchedule && datesValid,
    };
  });

  const historical = await getReportPeriodProgress(projectId, actualAsOfDate, now);
  const actualRows = historical.activities as HistoricalActivity[] | null;
  const planById = new Map(planned.map(({ activity, value, verified }) =>
    [activity.id, { value, verified }]));
  if (targetDate <= today && historical.historySource === "actual" && actualRows) {
    const historicalById = new Map(actualRows.map(row => [row.id, row]));
    for (const activity of currentActivities) {
      const dated = historicalById.get(activity.id);
      if (dated && dated.plannedHistoricalUnverified !== true
        && typeof dated.plannedProgress === "number" && Number.isFinite(dated.plannedProgress)) {
        planById.set(activity.id, { value: roundPercent(dated.plannedProgress), verified: true });
      }
    }
  }
  const activities = buildForecastActivities(
    currentActivities,
    planById,
    actualRows,
    targetDate,
    actualAsOfDate,
  );
  // A complete reviewed estimate is a usable historical aggregate, but its
  // linked activity values must remain marked as estimates in the snapshot.
  const hasCompleteHistoricalAggregate = historical.available
    && (historical.historySource === "actual" || historical.historySource === "estimated")
    && typeof historical.overallProgress === "number"
    && Number.isFinite(historical.overallProgress);
  let actualProgress = hasCompleteHistoricalAggregate
    ? roundPercent(historical.overallProgress!)
    : null;
  let actualSource: ReportForecastProgress["actualSource"] = actualProgress === null
    ? "unavailable"
    : historical.historySource === "estimated" ? "estimated_history" : "history";
  let actualReportNumber: number | null = null;
  let manualSuggestion: ReportForecastProgress["manualSuggestion"] = null;

  if (actualProgress === null) {
    const reports = await db.select({
      reportNumber: reportsTable.reportNumber,
      status: reportsTable.status,
      forecastDraft: reportsTable.forecastDraft,
      periodEnd: reportsTable.periodEnd,
      reportDate: reportsTable.reportDate,
      progressPercentage: reportsTable.progressPercentage,
      progressSource: reportsTable.progressSource,
      progressAsOfDate: reportsTable.progressAsOfDate,
    }).from(reportsTable)
      .where(eq(reportsTable.projectId, projectId))
      .orderBy(desc(reportsTable.reportNumber));
    const validPercent = (value: unknown): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
    const approvedReport = reports.find(report =>
      report.status === "approved"
      && report.forecastDraft !== true
      && reportDay(report.periodEnd) === actualAsOfDate
      && validPercent(report.progressPercentage),
    );
    if (approvedReport) {
      actualProgress = roundPercent(approvedReport.progressPercentage);
      actualSource = "approved_report";
      actualReportNumber = approvedReport.reportNumber;
    } else if (targetDate <= today) {
      const manualReport = reports.find(report =>
        report.status === "draft"
        && report.forecastDraft !== true
        && report.progressSource === "manual"
        && reportDay(report.progressAsOfDate) === targetDate
        && validPercent(report.progressPercentage),
      );
      if (manualReport) {
        manualSuggestion = {
          reportNumber: manualReport.reportNumber,
          progressPercentage: roundPercent(manualReport.progressPercentage),
          actualAsOfDate: targetDate,
          reportDate: reportDay(manualReport.reportDate) ?? targetDate,
        };
      }
    }
  }
  const allPlannedKnown = activities.every(activity => !activity.plannedHistoricalUnverified);
  const plannedProgress = targetDate <= today
    && historical.historySource === "actual"
    && historical.plannedProgress !== null
    ? historical.plannedProgress
    : !activities.length && hasProjectSchedule
      ? roundPercent(calcActivityPlannedProgress({
          plannedStartDate: project.startDate,
          plannedEndDate: project.expectedEndDate,
        }, asOf))
      : hasProjectSchedule && allPlannedKnown
        ? weighted(activities.map(activity => ({ value: activity.plannedProgress!, weight: activity.weight })))
        : null;

  return {
    forecastDraft: true,
    targetDate,
    today,
    actualAsOfDate,
    actualAvailable: actualProgress !== null,
    actualProgress,
    plannedProgress,
    plannedSource: plannedProgress === null ? "unavailable" : "project_schedule",
    actualSource,
    actualReportNumber,
    manualSuggestion,
    activities,
  };
}
