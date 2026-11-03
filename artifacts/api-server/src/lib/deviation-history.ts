import { utcDay } from "./progress";

type SavedReport = {
  id: number; reportDate: string; periodEnd: string; activitiesSnapshot: unknown;
  createdAt: Date | string; progressPercentage: number;
  progressSource?: string | null; progressAsOfDate?: string | null;
};
export type HistoryPoint = {
  date: string; plannedProgress: number | null; actualProgress: number | null;
  deviation: number | null; kind: "report" | "live"; reportId: number | null; baselineStatus: string;
};
const validPercent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Never reconstruct report history from today's catalogue, dates or weights. */
export function buildDeviationHistory(reports: SavedReport[], live: HistoryPoint, allowReports = true): HistoryPoint[] {
  const points = allowReports ? reports.flatMap(r => {
    const day = r.periodEnd || r.reportDate;
    if (!validDay(day) || day > live.date) return [];
    const raw = r.activitiesSnapshot;
    const snapshot = Array.isArray(raw) && raw.length > 0 && raw.every(x => x && typeof x === "object")
      ? raw as Record<string, unknown>[] : null;
    const weight = (x: Record<string, unknown>) => typeof x.weight === "number" && Number.isFinite(x.weight) && x.weight > 0 ? x.weight : null;
    const knownWeights = snapshot != null && snapshot.every(x => weight(x) != null);
    const total = knownWeights ? snapshot!.reduce((s, x) => s + weight(x)!, 0) : 0;
    // Explicit snapshot flags establish period coverage. Legacy timestamps at/before
    // the period day establish actual capture only, not membership/baseline coverage.
    const actualKnown = snapshot != null && knownWeights && snapshot.every(x => {
      if (x.actualHistoricalUnverified === true || x.referenceOnly === true || !validPercent(x.actualProgress)) return false;
      if (typeof x.actualAsOfDate === "string") return x.actualAsOfDate === day;
      const stamp = typeof x.actualRecordedAt === "string" ? x.actualRecordedAt : r.createdAt;
      const captured = utcDay(stamp).getTime();
      return x.plannedHistoricalUnverified === false && Number.isFinite(captured)
        && captured <= utcDay(day).getTime();
    });
    const plannedKnown = snapshot != null && knownWeights && snapshot.every(x =>
      x.plannedHistoricalUnverified === false && x.referenceOnly !== true && validPercent(x.plannedProgress)
      && (x.plannedAsOfDate == null || x.plannedAsOfDate === day));
    const planned = plannedKnown ? snapshot!.reduce((s, x) => s + (x.plannedProgress as number) * weight(x)!, 0) / total : null;
    // A report-approved aggregate is evidence for that report period only.
    const approvedAggregate = r.progressAsOfDate === day && (r.progressSource === "history" || r.progressSource === "manual")
      && validPercent(r.progressPercentage);
    const actual = approvedAggregate ? r.progressPercentage : actualKnown
      ? snapshot!.reduce((s, x) => s + (x.actualProgress as number) * weight(x)!, 0) / total : null;
    return [{
      date: day, plannedProgress: planned, actualProgress: actual,
      deviation: planned == null || actual == null ? null : actual - planned,
      kind: "report" as const, reportId: r.id,
      baselineStatus: planned == null ? "planned_unverified" : actual == null ? "actual_unverified" : "available",
    }];
  }) : [];
  // Stable ordering retains multiple reports and today's independent live measurement.
  return [...points.sort((a, b) => a.date.localeCompare(b.date) || a.reportId! - b.reportId!), live]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "live" ? 1 : b.kind === "live" ? -1 : 0));
}
