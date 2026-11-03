import { calcActivityPlannedProgress, hasValidProjectSchedule, utcDay, utcDayDifference, type PlannedCurve } from "./progress";

export type AnalysisActivity = {
  id: number; projectId: number; groupId: number | null; name: string;
  weight: number; actualProgress: number; plannedProgress: number;
  plannedStartDate: string | null; plannedEndDate: string | null;
  actualEndDate?: string | null; externalSourceGroupId: number | null;
};
export type AnalysisGroup = { id: number; projectId: number; name: string };
export type AnalysisProject = {
  id: number; name: string; startDate: string | null; expectedEndDate: string | null; noSchedule: boolean;
};
export type AnalysisGraph = {
  activities: AnalysisActivity[]; groups: AnalysisGroup[]; projects: AnalysisProject[];
};
export type AnalysisStatus = "unavailable" | "on_track" | "ahead" | "slightly_delayed" | "significantly_delayed";
export type SourceStatus = "local" | "live" | "stale" | "restricted";
export type SourceDetail = {
  activityName: string; actualProgress: number; plannedProgress: number | null;
  deviation: number | null; weightedImpact: number | null; effectiveWeight: number;
  sourceStatus: SourceStatus; sourceLabel: string | null; children: SourceDetail[];
};
export const weightOf = (a: { weight: number }) => Number.isFinite(a.weight) && a.weight > 0 ? a.weight : 1;
const percent = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
export function deviationStatus(value: number | null): AnalysisStatus {
  return value == null ? "unavailable" : value > 5 ? "ahead" : value >= -5 ? "on_track"
    : value >= -15 ? "slightly_delayed" : "significantly_delayed";
}
const scheduled = (p: AnalysisProject | undefined) =>
  !!p && !p.noSchedule && hasValidProjectSchedule(p.startDate, p.expectedEndDate);

/**
 * Pure, read-only graph evaluator. Only target activities enter project totals.
 * Source children explain their parent's weight; they never become target rows.
 * Path-local cycle detection preserves the last stored snapshot at the broken edge.
 */
export function analyzeActivities(
  project: AnalysisProject, graph: AnalysisGraph, readableProjects: Set<number>,
  asOf: Date, curve: PlannedCurve = "linear",
) {
  const groups = new Map(graph.groups.map(g => [g.id, g]));
  const projects = new Map(graph.projects.map(p => [p.id, p]));
  const children = new Map<number, AnalysisActivity[]>();
  for (const a of graph.activities) {
    if (a.groupId == null) continue;
    const list = children.get(a.groupId) ?? [];
    list.push(a); children.set(a.groupId, list);
  }
  type Value = { actual: number; planned: number | null; stale: boolean; children: AnalysisActivity[] };
  const memo = new Map<number, Value>();
  const values = (a: AnalysisActivity, ancestors: Set<number>): Value => {
    const sourceId = a.externalSourceGroupId;
    if (sourceId == null) {
      return { actual: percent(a.actualProgress),
        planned: scheduled(projects.get(a.projectId)) && hasValidProjectSchedule(a.plannedStartDate, a.plannedEndDate)
          ? calcActivityPlannedProgress(a, asOf, curve) : null, stale: false, children: [] };
    }
    const fallback = (): Value => ({ actual: percent(a.actualProgress),
      planned: Number.isFinite(a.plannedProgress) ? percent(a.plannedProgress) : null, stale: true, children: [] });
    if (ancestors.has(sourceId)) return fallback();
    const group = groups.get(sourceId);
    if (!group || !projects.has(group.projectId)) return fallback();
    const cached = memo.get(sourceId);
    if (cached) return cached;
    const next = new Set(ancestors); next.add(sourceId);
    const rows = (children.get(sourceId) ?? []).filter(c => c.projectId === group.projectId);
    // An empty live group has a known zero actual, but no planned baseline.
    const evaluated = rows.map(c => ({ row: c, value: values(c, next) }));
    const total = rows.reduce((s, c) => s + weightOf(c), 0);
    const result: Value = {
      actual: total ? evaluated.reduce((s, c) => s + c.value.actual * weightOf(c.row), 0) / total : 0,
      planned: scheduled(projects.get(group.projectId)) && total > 0 && evaluated.every(c => c.value.planned != null)
        ? evaluated.reduce((s, c) => s + c.value.planned! * weightOf(c.row), 0) / total : null,
      stale: evaluated.some(c => c.value.stale), children: rows,
    };
    // A value depending on a cycle is path-dependent; never memoize it.
    if (!result.stale) memo.set(sourceId, result);
    return result;
  };
  const details = (a: AnalysisActivity, share: number, allowPlan: boolean, ancestors: Set<number>): SourceDetail[] => {
    const sourceId = a.externalSourceGroupId;
    if (sourceId == null || ancestors.has(sourceId)) return [];
    const group = groups.get(sourceId);
    if (!group || !projects.has(group.projectId) || !readableProjects.has(group.projectId)) return [];
    const next = new Set(ancestors); next.add(sourceId);
    const rows = (children.get(sourceId) ?? []).filter(c => c.projectId === group.projectId);
    const total = rows.reduce((s, c) => s + weightOf(c), 0);
    return rows.map(c => {
      const value = values(c, next);
      const effectiveWeight = total ? share * weightOf(c) / total : 0;
      const source = c.externalSourceGroupId == null ? null : groups.get(c.externalSourceGroupId);
      const canRead = source != null && projects.has(source.projectId) && readableProjects.has(source.projectId);
      const deviation = allowPlan && value.planned != null ? value.actual - value.planned : null;
      return {
        activityName: c.name, actualProgress: value.actual, plannedProgress: allowPlan ? value.planned : null,
        deviation, weightedImpact: deviation == null ? null : deviation * effectiveWeight / 100,
        effectiveWeight, sourceStatus: (c.externalSourceGroupId == null ? "local"
          : value.stale ? "stale" : canRead ? "live" : "restricted") as SourceStatus,
        sourceLabel: canRead ? `${projects.get(source!.projectId)!.name} / ${source!.name}` : null,
        children: details(c, effectiveWeight, allowPlan, next),
      };
    });
  };
  const targets = graph.activities.filter(a => a.projectId === project.id);
  const total = targets.reduce((s, a) => s + weightOf(a), 0);
  const evaluated = targets.map(a => ({ a, value: values(a, new Set()) }));
  const hasPlan = scheduled(project) && total > 0 && evaluated.every(r => r.value.planned != null);
  const actual = total ? evaluated.reduce((s, r) => s + r.value.actual * weightOf(r.a), 0) / total : 0;
  const planned = hasPlan ? evaluated.reduce((s, r) => s + r.value.planned! * weightOf(r.a), 0) / total : null;
  const activitiesAnalysis = evaluated.map(({ a, value }) => {
    const effectiveWeight = total ? weightOf(a) / total * 100 : 0;
    const rowPlan = scheduled(project) ? value.planned : null;
    const deviation = rowPlan == null ? null : value.actual - rowPlan;
    const group = a.groupId == null ? undefined : groups.get(a.groupId);
    const source = a.externalSourceGroupId == null ? undefined : groups.get(a.externalSourceGroupId);
    const canRead = !!source && projects.has(source.projectId) && readableProjects.has(source.projectId);
    const sourceStatus: SourceStatus = a.externalSourceGroupId == null ? "local"
      : value.stale ? "stale" : canRead ? "live" : "restricted";
    const overrunDays = !value.stale && scheduled(project) && hasValidProjectSchedule(a.plannedStartDate, a.plannedEndDate) && value.actual < 100
      ? Math.max(0, utcDayDifference(asOf, a.plannedEndDate!)) : null;
    return {
      activityId: a.id, activityName: a.name, plannedProgress: rowPlan,
      actualProgress: value.actual, deviation, weight: weightOf(a), effectiveWeight,
      weightedImpact: deviation == null ? null : deviation * effectiveWeight / 100,
      overrunDays, delayDays: overrunDays,
      groupId: a.groupId, groupName: group?.projectId === project.id ? group.name : null,
      sourceKind: a.externalSourceGroupId == null ? "local" as const : "linked" as const,
      sourceStatus, sourceKey: a.externalSourceGroupId == null ? "local"
        : canRead ? `source-${source!.id}` : `restricted-${a.id}`,
      sourceLabel: canRead ? `${projects.get(source!.projectId)!.name} / ${source!.name}` : null,
      sourceDetails: details(a, effectiveWeight, scheduled(project), new Set()),
      status: deviationStatus(deviation),
    };
  });
  return { actualProgress: actual, plannedProgress: planned,
    progressDeviation: planned == null ? null : actual - planned,
    activitiesAnalysis, dataStatus: evaluated.some(r => r.value.stale) ? "stale" as const : "live" as const,
    scheduleStatus: project.noSchedule ? "no_schedule" as const
      : !project.startDate || !project.expectedEndDate ? "missing" as const
      : !scheduled(project) ? "invalid" as const : !hasPlan ? "incomplete" as const : "available" as const };
}

type Suspension = { startDate: string; endDate: string; type: string; datesShifted?: boolean };
/** Inclusive calendar-day union, clipped to elapsed project days (never future days). */
export function analyzeSuspensions(rows: Suspension[], start: string | null, end: string | null, asOf: Date) {
  type Interval = [number, number];
  const clip = (r: Suspension): Interval | null => {
    if (!start || !hasValidProjectSchedule(r.startDate, r.endDate)) return null;
    const lo = Math.max(utcDay(start).getTime(), utcDay(r.startDate).getTime());
    const hi = Math.min(utcDay(asOf).getTime(), utcDay(r.endDate).getTime(),
      end ? utcDay(end).getTime() : Infinity);
    return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? [lo, hi] : null;
  };
  const union = (list: Interval[]) => {
    const sorted = [...list].sort((a, b) => a[0] - b[0]);
    let days = 0, last = -Infinity;
    for (const [lo, hi] of sorted) {
      if (hi > last) days += (hi - Math.max(lo, last + 86400000)) / 86400000 + 1;
      last = Math.max(last, hi);
    }
    return days;
  };
  const periods = rows.map(r => ({ r, interval: clip(r) })).filter(x => x.interval != null);
  const qualifying = periods.filter(x => ["official_holiday", "force_majeure"].includes(x.r.type));
  const suspensionDays = union(qualifying.map(x => x.interval!));
  const shiftedSuspensionDays = union(qualifying.filter(x => x.r.datesShifted === true).map(x => x.interval!));
  return { suspensionDays, shiftedSuspensionDays,
    unshiftedSuspensionDays: suspensionDays - shiftedSuspensionDays,
    contractorSuspensionDays: union(periods.filter(x => x.r.type === "contractor_delay").map(x => x.interval!)),
    suspensionsBreakdown: ["official_holiday", "force_majeure", "contractor_delay"].map(type => ({
      type, days: union(periods.filter(x => x.r.type === type).map(x => x.interval!)),
      count: rows.filter(r => r.type === type).length,
    })).filter(x => x.count > 0) };
}

export function analyzeTime(project: AnalysisProject, planned: number | null, actual: number, asOf: Date, stale = false) {
  const duration = scheduled(project) ? Math.max(1, utcDayDifference(project.expectedEndDate!, project.startDate!)) : null;
  const timeDeviation = duration != null && planned != null ? (actual - planned) / 100 * duration : null;
  const overrunDays = !stale && duration != null && actual < 100 ? Math.max(0, utcDayDifference(asOf, project.expectedEndDate!)) : null;
  const spi = planned != null && planned > 0 ? actual / planned : null;
  // Forecast is conditional on remaining work continuing at observed average pace.
  // No completion date is inferred from a percentage of 100 or a stale snapshot.
  let forecastCompletionDate: string | null = null;
  let forecastStatus = actual >= 100 ? "completed_without_date" : actual <= 0 ? "not_started" : "unavailable";
  const elapsed = duration != null ? utcDayDifference(asOf, project.startDate!) : 0;
  if (!stale && duration != null && planned != null && planned > 0 && actual > 0 && actual < 100 && elapsed > 0) {
    const remaining = Math.max(1, Math.ceil(elapsed * (100 - actual) / actual));
    const day = new Date(utcDay(asOf).getTime() + remaining * 86400000);
    if (Number.isFinite(day.getTime()) && day.getUTCFullYear() <= 9999) {
      forecastCompletionDate = day.toISOString().slice(0, 10); forecastStatus = "estimated";
    }
  }
  return { timeDeviation, grossDelayDays: timeDeviation == null ? null : Math.max(0, -timeDeviation),
    netDelayDays: null, overrunDays, spi, forecastCompletionDate, forecastStatus,
    forecastDelayDays: forecastCompletionDate ? utcDayDifference(forecastCompletionDate, project.expectedEndDate!) : null,
    expectedProgressAtEnd: forecastCompletionDate && duration != null && elapsed > 0 && utcDayDifference(project.expectedEndDate!, asOf) >= 0
      ? Math.min(100, actual + utcDayDifference(project.expectedEndDate!, asOf) * actual / elapsed) : null };
}
