import type { ReportAiSnapshotRow } from "./report-ai-context";

const validPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/** Only dated, verified snapshot values may support historical inference.
 * Never expose unverified/current percentages as if they belonged to the period.
 * An end-of-period state is not evidence of work performed during the period.
 */
export function buildReportActivityAnalysis(rows: readonly ReportAiSnapshotRow[], periodEnd: string) {
  const activities = rows.map(row => {
    const actualVerified = row.actualAsOfDate === periodEnd
      && row.actualHistoricalUnverified !== true && validPercent(row.actualProgress);
    const plannedVerified = row.plannedAsOfDate === periodEnd
      && row.plannedHistoricalUnverified !== true && validPercent(row.plannedProgress);
    const actual = actualVerified ? row.actualProgress! : null;
    const planned = plannedVerified ? row.plannedProgress! : null;
    return {
      id: row.id,
      name: row.name ?? "بند بلا اسم",
      linkedSource: row.externalSourceGroupId != null,
      actualProgressAsOfPeriodEnd: actual,
      plannedProgressAsOfPeriodEnd: planned,
      variancePoints: actual !== null && planned !== null ? Math.round((actual - planned) * 10) / 10 : null,
      cumulativeState: actual === null ? "unknown" : actual >= 100 ? "completed" : actual > 0 ? "in_progress" : "not_started",
      plannedStartDate: plannedVerified ? row.plannedStartDate ?? null : null,
      plannedEndDate: plannedVerified ? row.plannedEndDate ?? null : null,
    };
  });
  return {
    asOfDate: periodEnd,
    scope: "cumulative_state_not_work_executed_during_period",
    totalActivities: activities.length,
    verifiedActualCount: activities.filter(a => a.actualProgressAsOfPeriodEnd !== null).length,
    verifiedPlanCount: activities.filter(a => a.plannedProgressAsOfPeriodEnd !== null).length,
    completedCount: activities.filter(a => a.cumulativeState === "completed").length,
    inProgressCount: activities.filter(a => a.cumulativeState === "in_progress").length,
    notStartedCount: activities.filter(a => a.cumulativeState === "not_started").length,
    belowPlanCount: activities.filter(a => a.variancePoints !== null && a.variancePoints < 0).length,
    activities,
  };
}

export type ReportActivityAnalysis = ReturnType<typeof buildReportActivityAnalysis>;
