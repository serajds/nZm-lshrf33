import { createHash } from "node:crypto";

export type ReportAiSnapshotRow = {
  id?: number;
  name?: string;
  status?: string;
  plannedProgress?: number;
  actualProgress?: number;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  plannedAsOfDate?: string;
  plannedHistoricalUnverified?: boolean;
  actualRecordedAt?: string;
  actualAsOfDate?: string;
  actualHistoricalUnverified?: boolean;
  actualManuallyApproved?: boolean;
  weight?: number;
  externalSourceGroupId?: number | null;
  sortOrder?: number;
};

/** Ignore capture time; compare only values that can change the AI narrative. */
export function reportAiSnapshotFingerprint(
  reportDate: string,
  rows: readonly ReportAiSnapshotRow[],
  periodStart?: string,
  periodEnd?: string,
) {
  return createHash("sha256").update(JSON.stringify({
    reportDate, periodStart, periodEnd,
    rows: rows.map(row => ({
      id: row.id, name: row.name, status: row.status,
      plannedProgress: row.plannedProgress, actualProgress: row.actualProgress, weight: row.weight,
      plannedStartDate: row.plannedStartDate, plannedEndDate: row.plannedEndDate,
      actualStartDate: row.actualStartDate, actualEndDate: row.actualEndDate,
      externalSourceGroupId: row.externalSourceGroupId,
    })),
  })).digest("hex");
}

export function buildReportAiContext(
  rows: readonly ReportAiSnapshotRow[],
  reportDate: string,
  currentGroupsByActivityId: ReadonlyMap<number, string>,
) {
  return rows.map(row => {
    const asOfDate = row.actualAsOfDate ?? reportDate;
    const plannedVerified = row.plannedHistoricalUnverified !== true
      && row.plannedAsOfDate === asOfDate;
    const planned = plannedVerified && Number.isFinite(row.plannedProgress)
      ? row.plannedProgress! : null;
    const actual = Number.isFinite(row.actualProgress) ? row.actualProgress! : null;
    const actualRecordedAfterReportDate = Boolean(row.actualRecordedAt
      && row.actualRecordedAt.slice(0, 10) > asOfDate);
    const actualVerifiedAtReportDate = row.actualHistoricalUnverified !== true
      && Boolean(row.actualAsOfDate || row.actualRecordedAt && row.actualRecordedAt.slice(0, 10) <= reportDate);
    const deviation = actual !== null && planned !== null && actualVerifiedAtReportDate
      ? Math.round((actual - planned) * 10) / 10 : null;
    return {
      name: row.name ?? "بند بلا اسم",
      group: typeof row.id === "number"
        ? currentGroupsByActivityId.get(row.id) ?? "غير موثقة في لقطة التقرير"
        : "غير موثقة في لقطة التقرير",
      groupIsCurrentReferenceOnly: true,
      status: row.status ?? "غير محددة",
      actualProgress: actual,
      actualRecordedAt: row.actualRecordedAt ?? null,
      actualRecordedAfterReportDate,
      actualHistoricalUnverified: !actualVerifiedAtReportDate,
      plannedProgressAtReportDate: planned,
      plannedAsOfDate: row.plannedAsOfDate ?? null,
      plannedHistoricalUnverified: !plannedVerified,
      deviationPoints: deviation,
      positionAgainstPlan: deviation === null ? "غير قابل للتحقق تاريخياً"
        : deviation < 0 ? "خلف المخطط" : deviation > 0 ? "متقدم عن المخطط" : "مطابق للمخطط",
      plannedStartDate: row.plannedStartDate ?? null,
      plannedEndDate: row.plannedEndDate ?? null,
      actualStartDate: row.actualStartDate ?? null,
      actualEndDate: row.actualEndDate ?? null,
      // A late completion is verifiable from recorded dates; an unfinished
      // activity needs a historical as-of date and cannot use today's clock.
      scheduleDelay: row.actualEndDate && row.actualEndDate <= asOfDate && row.plannedEndDate
        ? row.actualEndDate > row.plannedEndDate ? "اكتمل بعد النهاية المخططة" : "لم يكتمل بعد النهاية المخططة"
        : row.plannedEndDate && actualVerifiedAtReportDate && row.status !== "completed" && asOfDate > row.plannedEndDate
          ? "كان غير مكتمل بعد النهاية المخططة في تاريخ التقرير" : "غير مثبت",
    };
  });
}