import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { calcActivityPlannedProgress, hasValidProjectSchedule, roundPercent } from "./progress";

export type HistoricalActivity = {
  id: number; name: string; groupId: number | null;
  plannedStartDate: string | null; plannedEndDate: string | null;
  actualStartDate: string | null; actualEndDate: string | null;
  actualProgress: number; plannedProgress: number; weight: number;
  status: string; sortOrder: number; externalSourceGroupId: number | null;
};
export type HistoricalProject = {
  projectId: number; noSchedule: boolean; startDate: string | null; expectedEndDate: string | null;
  activities: HistoricalActivity[]; groups: { id: number; name: string }[];
};
type HistoryRow = { project_id: number; captured_at: Date; snapshot: HistoricalProject };

export function validReportDay(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

export function periodCutoff(day: string): Date {
  // Reports use the Libyan calendar day, not the issuing browser's timezone.
  return new Date(Date.parse(`${day}T00:00:00+02:00`) + 86_400_000);
}

export function weightedHistoryProgress(rows: { actualProgress: number; weight: number }[]) {
  let sum = 0, total = 0;
  for (const row of rows) {
    const weight = Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
    sum += row.actualProgress * weight;
    total += weight;
  }
  return total ? roundPercent(sum / total) : 0;
}

/** Resolve linked groups exclusively from historical states, never today's DB rows. */
export function resolveHistoricalActivities(project: HistoricalProject, states: HistoricalProject[], day: string) {
  const owners = new Map(states.flatMap(p => p.groups.map(g => [g.id, p] as const)));
  const asOf = new Date(`${day}T00:00:00Z`);
  const resolve = (activity: HistoricalActivity, ancestors: Set<number>): HistoricalActivity & { plannedHistoricalUnverified?: boolean } => {
    const sourceId = activity.externalSourceGroupId;
    if (sourceId == null) return { ...activity, plannedProgress: calcActivityPlannedProgress(activity, asOf) };
    const owner = owners.get(sourceId);
    // Missing/deleted sources retain the last stored values, as in the live engine.
    if (!owner || ancestors.has(sourceId)) return { ...activity, plannedHistoricalUnverified: true };
    const next = new Set(ancestors).add(sourceId);
    const children = owner.activities.filter(a => a.groupId === sourceId).map(a => resolve(a, next));
    return {
      ...activity,
      actualProgress: weightedHistoryProgress(children),
      plannedProgress: weightedHistoryProgress(children.map(a => ({ ...a, actualProgress: a.plannedProgress }))),
      plannedHistoricalUnverified: children.some(a => a.plannedHistoricalUnverified),
    };
  };
  const hasSchedule = !project.noSchedule && hasValidProjectSchedule(project.startDate, project.expectedEndDate);
  return project.activities.map(a => {
    const resolved = resolve(a, new Set());
    return {
      ...resolved,
      plannedProgress: hasSchedule ? resolved.plannedProgress : 0,
      plannedAsOfDate: day,
      plannedHistoricalUnverified: !hasSchedule || resolved.plannedHistoricalUnverified === true,
      actualAsOfDate: day,
      actualHistoricalUnverified: false,
    };
  });
}

export async function getReportPeriodProgress(projectId: number, day: string, now = new Date()) {
  if (!validReportDay(day)) throw new Error("تاريخ نهاية الفترة غير صالح");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { rows: starts } = await pool.query<{ started_at: Date | null }>(
    "SELECT min(captured_at) AS started_at FROM project_progress_history WHERE project_id=$1", [projectId]);
  const trackingStartedAt = starts[0]?.started_at?.toISOString() ?? null;
  const missing = (reason: string) => ({
    available: false as const, asOfDate: day, overallProgress: null, plannedProgress: null,
    variance: null, spi: null, trackingStartedAt, capturedAt: null, fingerprint: null,
    reason, activities: null,
  });
  if (day > today) return missing("نهاية الفترة في المستقبل؛ لا تتوفر نسبة إنجاز فعلية لتاريخ لم يأتِ بعد.");
  const cutoff = new Date(Math.min(periodCutoff(day).getTime(), now.getTime() + 1));
  const { rows } = await pool.query<HistoryRow>(
    `SELECT DISTINCT ON (project_id) project_id, captured_at, snapshot
     FROM project_progress_history WHERE captured_at < $1
     ORDER BY project_id, captured_at DESC, id DESC`, [cutoff]);
  const root = rows.find(row => row.project_id === projectId);
  if (!root) return missing("لا يوجد سجل موثوق يغطي نهاية هذه الفترة. أدخل نسبة موثّقة يدوياً؛ لن يُستخدم إنجاز المشروع الحالي.");
  const activities = resolveHistoricalActivities(root.snapshot, rows.map(r => r.snapshot), day)
    .map(a => ({ ...a, actualRecordedAt: root.captured_at.toISOString() }));
  const overallProgress = weightedHistoryProgress(activities);
  const hasSchedule = !root.snapshot.noSchedule && hasValidProjectSchedule(root.snapshot.startDate, root.snapshot.expectedEndDate);
  const plannedProgress = hasSchedule && !activities.some(a => a.plannedHistoricalUnverified)
    ? weightedHistoryProgress(activities.map(a => ({ ...a, actualProgress: a.plannedProgress }))) : null;
  return {
    available: true as const, asOfDate: day, overallProgress, plannedProgress,
    variance: plannedProgress === null ? null : roundPercent(overallProgress - plannedProgress),
    spi: plannedProgress === null || plannedProgress === 0 ? null : Math.round(overallProgress / plannedProgress * 100) / 100,
    trackingStartedAt, capturedAt: root.captured_at.toISOString(), reason: null, activities,
    fingerprint: createHash("sha256").update(JSON.stringify({ day, activities })).digest("hex"),
  };
}
