import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { calcActivityPlannedProgress, hasValidProjectSchedule, roundPercent } from "./progress";
import { captureProjectProgressHistory } from "./capture-project-progress-history";

export type HistoricalActivity = {
  id: number; name: string; groupId: number | null;
  plannedStartDate: string | null; plannedEndDate: string | null;
  actualStartDate: string | null; actualEndDate: string | null;
  actualProgress: number; plannedProgress: number; weight: number;
  status: string; sortOrder: number; externalSourceGroupId: number | null;
  actualHistoricalUnverified?: boolean;
};
export type HistoricalProject = {
  projectId: number; noSchedule: boolean; startDate: string | null; expectedEndDate: string | null;
  activities: HistoricalActivity[]; groups: { id: number; name: string }[];
};
type HistoryRow = {
  project_id: number;
  captured_at: Date;
  snapshot: HistoricalProject;
  source?: "actual" | "estimated";
};

/** Read-only reconstruction: today's catalogue is reference material, never historical actuals. */
export async function getLegacyReportActivities(projectId: number, day: string) {
  const { rows } = await pool.query<{
    id: number; name: string; plannedStartDate: string | null; plannedEndDate: string | null;
    externalSourceGroupId: number | null; sortOrder: number;
    details: Record<string, unknown> | null; recordedAt: Date | null;
  }>(`
    SELECT a.id, a.name, a.planned_start_date::text AS "plannedStartDate",
      a.planned_end_date::text AS "plannedEndDate",
      a.external_source_group_id AS "externalSourceGroupId", a.sort_order AS "sortOrder",
      h.details, h.created_at AS "recordedAt"
    FROM activities a
    LEFT JOIN LATERAL (
      SELECT details, created_at FROM audit_log
      WHERE project_id = a.project_id AND entity_type = 'activity' AND entity_id = a.id
        AND action IN ('create', 'update') AND created_at < $2
        AND (details ? 'actualProgressAfter' OR details ? 'actualProgress')
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) h ON true
    WHERE a.project_id = $1 ORDER BY a.sort_order, a.id
  `, [projectId, periodCutoff(day)]);
  return rows.map(row => {
    const value = row.details?.actualProgressAfter ?? row.details?.actualProgress;
    // Linked aggregates need the historical source membership/weights, not a cached audit value.
    const verified = row.externalSourceGroupId == null && typeof value === "number"
      && Number.isFinite(value) && value >= 0 && value <= 100;
    return {
      id: row.id, name: row.name, groupId: null,
      plannedStartDate: row.plannedStartDate, plannedEndDate: row.plannedEndDate,
      actualStartDate: null, actualEndDate: null, weight: 1,
      sortOrder: row.sortOrder, externalSourceGroupId: row.externalSourceGroupId,
      actualProgress: verified ? value : 0,
      actualHistoricalUnverified: !verified,
      actualAsOfDate: verified ? day : undefined,
      actualRecordedAt: verified ? row.recordedAt?.toISOString() : undefined,
      status: verified ? value === 100 ? "completed" : value > 0 ? "in_progress" : "not_started" : "unknown",
      plannedProgress: calcActivityPlannedProgress(row, new Date(`${day}T00:00:00Z`)),
      plannedHistoricalUnverified: true,
      referenceOnly: true,
    };
  });
}

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
    if (!owner || ancestors.has(sourceId)) {
      return { ...activity, actualHistoricalUnverified: true, plannedHistoricalUnverified: true };
    }
    const next = new Set(ancestors).add(sourceId);
    const children = owner.activities.filter(a => a.groupId === sourceId).map(a => resolve(a, next));
    return {
      ...activity,
      actualProgress: weightedHistoryProgress(children),
      actualHistoricalUnverified: children.some(a => a.actualHistoricalUnverified),
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
      actualHistoricalUnverified: resolved.actualHistoricalUnverified === true,
    };
  });
}

export async function getReportPeriodProgress(
  projectId: number,
  day: string,
  now = new Date(),
  periodStart?: string,
) {
  if (!validReportDay(day)) throw new Error("تاريخ نهاية الفترة غير صالح");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let queryNow = now;
  let { rows: starts } = await pool.query<{ started_at: Date | null }>(
    "SELECT min(captured_at) AS started_at FROM project_progress_history WHERE project_id=$1", [projectId]);
  let trackingStartedAt = starts[0]?.started_at?.toISOString() ?? null;
  if (!trackingStartedAt && day === today) {
    // Existing production projects may predate application-side history
    // capture. A first request for today's report can safely establish a
    // current baseline; older report dates must remain unavailable.
    await captureProjectProgressHistory(projectId);
    ({ rows: starts } = await pool.query<{ started_at: Date | null }>(
      "SELECT min(captured_at) AS started_at FROM project_progress_history WHERE project_id=$1", [projectId]));
    trackingStartedAt = starts[0]?.started_at?.toISOString() ?? null;
    queryNow = new Date();
  }
  const missing = (reason: string) => ({
    available: false as const, asOfDate: day, overallProgress: null, plannedProgress: null,
    variance: null, spi: null, trackingStartedAt, capturedAt: null, fingerprint: null,
    periodStartProgress: null, periodIncrease: null, historySource: null,
    reason, activities: null,
  });
  if (day > today) return missing("نهاية الفترة في المستقبل؛ لا تتوفر نسبة إنجاز فعلية لتاريخ لم يأتِ بعد.");
  const cutoff = new Date(Math.min(periodCutoff(day).getTime(), queryNow.getTime() + 1));
  const { rows } = await pool.query<HistoryRow>(
    `SELECT DISTINCT ON (project_id) project_id, captured_at, snapshot, source
     FROM project_progress_history WHERE captured_at < $1
     ORDER BY project_id, captured_at DESC, id DESC`, [cutoff]);
  const root = rows.find(row => row.project_id === projectId);
  if (!root) return {
    ...missing("اعتمد نسبة التقرير يدوياً؛ تُعرض نسب البنود الموثقة في السجل والجدول الحالي كمرجع."),
    activities: await getLegacyReportActivities(projectId, day),
  };
  const activities = resolveHistoricalActivities(root.snapshot, rows.map(r => r.snapshot), day)
    .map(a => ({
      ...a,
      actualRecordedAt: root.captured_at.toISOString(),
      plannedHistoricalUnverified: a.plannedHistoricalUnverified === true || root.source === "estimated",
    }));
  if (activities.some(activity => activity.actualHistoricalUnverified)) {
    return {
      ...missing("لا تتوفر نقاط تاريخية موثوقة لبعض البنود المرتبطة؛ لا تُستخدم نسبتها الحالية في إجمالي الفترة."),
      activities,
      capturedAt: root.captured_at.toISOString(),
      historySource: root.source ?? "actual",
      fingerprint: createHash("sha256").update(JSON.stringify({ day, activities })).digest("hex"),
    };
  }
  const overallProgress = weightedHistoryProgress(activities);
  const hasSchedule = !root.snapshot.noSchedule && hasValidProjectSchedule(root.snapshot.startDate, root.snapshot.expectedEndDate);
  const plannedProgress = hasSchedule && !activities.some(a => a.plannedHistoricalUnverified)
    ? weightedHistoryProgress(activities.map(a => ({ ...a, actualProgress: a.plannedProgress }))) : null;
  let periodStartProgress: number | null = null;
  if (periodStart && validReportDay(periodStart) && periodStart < day && periodStart <= today) {
    const startCutoff = Math.min(Date.parse(`${periodStart}T00:00:00+02:00`), queryNow.getTime() + 1);
    const { rows: startRows } = await pool.query<HistoryRow>(
      `SELECT DISTINCT ON (project_id) project_id, captured_at, snapshot, source
       FROM project_progress_history WHERE captured_at < $1
       ORDER BY project_id, captured_at DESC, id DESC`, [new Date(startCutoff)]);
    const startRoot = startRows.find(row => row.project_id === projectId);
    if (startRoot) {
      const startActivities = resolveHistoricalActivities(startRoot.snapshot, startRows.map(row => row.snapshot), periodStart);
      if (!startActivities.some(activity => activity.actualHistoricalUnverified)) {
        periodStartProgress = weightedHistoryProgress(startActivities);
      }
    }
  }
  return {
    available: true as const, asOfDate: day, overallProgress, plannedProgress,
    variance: plannedProgress === null ? null : roundPercent(overallProgress - plannedProgress),
    spi: plannedProgress === null || plannedProgress === 0 ? null : Math.round(overallProgress / plannedProgress * 100) / 100,
    periodStartProgress,
    periodIncrease: periodStartProgress === null ? null : roundPercent(overallProgress - periodStartProgress),
    historySource: root.source ?? "actual",
    trackingStartedAt, capturedAt: root.captured_at.toISOString(), reason: null, activities,
    fingerprint: createHash("sha256").update(JSON.stringify({ day, periodStart, periodStartProgress, activities })).digest("hex"),
  };
}
