import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  activitiesTable, activityGroupsTable, db, projectProgressHistoryBatchesTable,
  projectProgressHistoryTable, projectSuspensionsTable, projectsTable, reportsTable,
} from "@workspace/db";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectManager } from "../middlewares/auth";
import { buildProjectProgressSnapshot } from "../lib/capture-project-progress-history";
import {
  historicalBackfillMethodology, isBackfillActivityDayWorkSafe, previewHistoricalProgress, validBackfillDay, weightedProgress,
  type BackfillActivity, type BackfillInput, type BackfillSuspension,
} from "../lib/historical-progress-backfill";

const router: IRouter = Router();
const lockSql = sql`SELECT pg_advisory_xact_lock(84620, 1)`;
const MAX_BODY_POINTS = 500;
const MAX_BACKFILL_HISTORY_CELLS = 500_000;
const HISTORY_TOO_LARGE_ERROR = "سجل المشروع ومصادره أكبر من حد الفحص الآمن في طلب واحد؛ لم تُغيّر أي بيانات.";
const PREVIEW_TOO_LARGE_ERROR = "الفترة مع عدد البنود تتجاوز حد المعاينة الآمن؛ قلّص الفترة ثم أعد المحاولة. لم تُغيّر أي بيانات.";

function periodDayCount(periodStart: string, realityDate: string): number {
  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${realityDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

async function estimateBackfillHistoryCells(projectId: number) {
  const [activityRows, [historyCount], [reportCount]] = await Promise.all([
    db.select({ externalSourceGroupId: activitiesTable.externalSourceGroupId })
      .from(activitiesTable).where(eq(activitiesTable.projectId, projectId)),
    db.select({ value: count() }).from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, projectId)),
    db.select({ value: count() }).from(reportsTable).where(and(
      eq(reportsTable.projectId, projectId), eq(reportsTable.progressSource, "history"),
    )),
  ]);
  const linkedGroupIds = [...new Set(activityRows.map(row => row.externalSourceGroupId)
    .filter((id): id is number => id != null))];
  let sourceCells = 0;
  if (linkedGroupIds.length) {
    const sourceGroups = await db.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId })
      .from(activityGroupsTable).where(inArray(activityGroupsTable.id, linkedGroupIds));
    const sourceProjectIds = [...new Set(sourceGroups.map(group => group.projectId))];
    if (sourceProjectIds.length) {
      const [sourceHistoryCounts, sourceActivityCounts] = await Promise.all([
        db.select({ projectId: projectProgressHistoryTable.projectId, value: count() })
          .from(projectProgressHistoryTable)
          .where(inArray(projectProgressHistoryTable.projectId, sourceProjectIds))
          .groupBy(projectProgressHistoryTable.projectId),
        db.select({ projectId: activitiesTable.projectId, value: count() })
          .from(activitiesTable)
          .where(inArray(activitiesTable.projectId, sourceProjectIds))
          .groupBy(activitiesTable.projectId),
      ]);
      const sourceActivityCountByProject = new Map(sourceActivityCounts.map(row => [row.projectId, row.value]));
      sourceCells = sourceHistoryCounts.reduce((total, row) =>
        total + row.value * (sourceActivityCountByProject.get(row.projectId) ?? 0), 0);
    }
  }
  return {
    activityCount: activityRows.length,
    historyCells: activityRows.length * (historyCount.value + reportCount.value) + sourceCells,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function tripoliDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function latestPointOnOrBefore(points: Array<{ date: string; progress: number }>, date: string) {
  let low = 0, high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].date <= date) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? points[low - 1] : undefined;
}

function asBackfillInput(raw: unknown): BackfillInput | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  if (!validBackfillDay(body.periodStart) || !validBackfillDay(body.realityDate)
    || !Number.isFinite(body.realityProgress) || Number(body.realityProgress) < 0 || Number(body.realityProgress) > 100) return null;
  const activityInputs = Array.isArray(body.activityInputs) ? body.activityInputs.slice(0, 1000).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!Number.isSafeInteger(row.activityId) || Number(row.activityId) <= 0) return [];
    return [{
      activityId: Number(row.activityId),
      ...(validBackfillDay(row.startDate) ? { startDate: row.startDate } : {}),
      ...(validBackfillDay(row.completionDate) ? { completionDate: row.completionDate } : {}),
    }];
  }) : [];
  const referencePoints = Array.isArray(body.referencePoints) && body.referencePoints.length <= MAX_BODY_POINTS
    ? body.referencePoints.flatMap(point => {
      if (!point || typeof point !== "object") return [];
      const row = point as Record<string, unknown>;
      if (!validBackfillDay(row.date) || !Number.isFinite(row.progress)
        || Number(row.progress) < 0 || Number(row.progress) > 100) return [];
      return [{ date: row.date, progress: Number(row.progress) }];
    }) : [];
  return {
    periodStart: body.periodStart,
    realityDate: body.realityDate,
    realityProgress: Number(body.realityProgress),
    ...(body.automatic === true ? { automatic: true } : {}),
    activityInputs,
    referencePoints,
  };
}

async function readBackfillState(projectId: number) {
  const [project] = await db.select({
    id: projectsTable.id, name: projectsTable.name, noSchedule: projectsTable.noSchedule,
    startDate: projectsTable.startDate, expectedEndDate: projectsTable.expectedEndDate,
    updatedAt: projectsTable.updatedAt,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) return null;

  const [activities, suspensions, groups, batches] = await Promise.all([
    db.select({
      id: activitiesTable.id, name: activitiesTable.name, status: activitiesTable.status,
      actualProgress: activitiesTable.actualProgress, weight: activitiesTable.weight,
      actualStartDate: activitiesTable.actualStartDate, actualEndDate: activitiesTable.actualEndDate,
      plannedStartDate: activitiesTable.plannedStartDate, plannedEndDate: activitiesTable.plannedEndDate,
      groupId: activitiesTable.groupId, sortOrder: activitiesTable.sortOrder,
      externalSourceGroupId: activitiesTable.externalSourceGroupId,
    }).from(activitiesTable).where(eq(activitiesTable.projectId, projectId))
      .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id)),
    db.select({
      type: projectSuspensionsTable.type, startDate: projectSuspensionsTable.startDate,
      endDate: projectSuspensionsTable.endDate, approvedBy: projectSuspensionsTable.approvedBy,
    }).from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId)),
    db.select({ id: activityGroupsTable.id, linkedProjectId: activityGroupsTable.linkedProjectId })
      .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId)),
    db.select().from(projectProgressHistoryBatchesTable)
      .where(eq(projectProgressHistoryBatchesTable.projectId, projectId))
      .orderBy(desc(projectProgressHistoryBatchesTable.createdAt)),
  ]);
  const linkedGroupIds = [...new Set(activities.map(activity => activity.externalSourceGroupId)
    .filter((id): id is number => id != null))];
  const sourceGroups = linkedGroupIds.length
    ? await db.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId })
      .from(activityGroupsTable).where(inArray(activityGroupsTable.id, linkedGroupIds))
    : [];
  const sourceProjectIds = [...new Set(sourceGroups.map(group => group.projectId))];

  const history = await db.select({
    id: projectProgressHistoryTable.id,
    capturedAt: projectProgressHistoryTable.capturedAt,
    snapshot: projectProgressHistoryTable.snapshot,
    source: projectProgressHistoryTable.source,
  }).from(projectProgressHistoryTable).where(eq(projectProgressHistoryTable.projectId, projectId))
    .orderBy(asc(projectProgressHistoryTable.capturedAt), asc(projectProgressHistoryTable.id));
  const sourceHistory = sourceProjectIds.length
    ? await db.select({
      projectId: projectProgressHistoryTable.projectId,
      capturedAt: projectProgressHistoryTable.capturedAt,
      snapshot: projectProgressHistoryTable.snapshot,
      source: projectProgressHistoryTable.source,
    }).from(projectProgressHistoryTable)
      .where(inArray(projectProgressHistoryTable.projectId, sourceProjectIds))
      .orderBy(asc(projectProgressHistoryTable.capturedAt), asc(projectProgressHistoryTable.id))
    : [];
  const reportAnchors = await db.select({
    periodEnd: reportsTable.periodEnd,
    progressAsOfDate: reportsTable.progressAsOfDate,
    progressPercentage: reportsTable.progressPercentage,
    activitiesSnapshot: reportsTable.activitiesSnapshot,
  }).from(reportsTable).where(and(
    eq(reportsTable.projectId, projectId),
    eq(reportsTable.progressSource, "history"),
  ));

  const activityInputs = new Map<number, { activityId: number; points: Array<{ date: string; progress: number }> }>();
  for (const activity of activities) activityInputs.set(activity.id, { activityId: activity.id, points: [] });
  const externalSourceGroupByActivity = new Map(activities.map(activity => [activity.id, activity.externalSourceGroupId]));
  const addHistoricalPoint = (id: number, date: string, progress: unknown) => {
    const input = activityInputs.get(id);
    if (!input || !validBackfillDay(date) || !Number.isFinite(progress)
      || Number(progress) < 0 || Number(progress) > 100) return;
    input.points.push({ date, progress: Number(progress) });
  };
  for (const row of history) {
    if (row.source !== "actual") continue;
    const date = tripoliDay(row.capturedAt);
    if (!row.snapshot || typeof row.snapshot !== "object") continue;
    const snapshotActivities = (row.snapshot as { activities?: Array<{ id: number; actualProgress: number }> }).activities;
    for (const activity of snapshotActivities ?? []) {
      if (externalSourceGroupByActivity.get(activity.id) == null) {
        addHistoricalPoint(activity.id, date, activity.actualProgress);
      }
    }
  }
  for (const report of reportAnchors) {
    const date = report.progressAsOfDate ?? report.periodEnd;
    if (!Array.isArray(report.activitiesSnapshot)) continue;
    for (const row of report.activitiesSnapshot as Array<{ id?: number; actualProgress?: number; actualHistoricalUnverified?: boolean }>) {
      if (typeof row.id === "number" && row.actualHistoricalUnverified !== true
        && activities.find(item => item.id === row.id)?.externalSourceGroupId == null) {
        addHistoricalPoint(row.id, date, row.actualProgress);
      }
    }
  }
  const sourceProjectByGroup = new Map(sourceGroups.map(group => [group.id, group.projectId]));
  const linkedActivitiesByGroup = new Map<number, number[]>();
  for (const activity of activities) {
    if (activity.externalSourceGroupId == null) continue;
    const linked = linkedActivitiesByGroup.get(activity.externalSourceGroupId) ?? [];
    linked.push(activity.id);
    linkedActivitiesByGroup.set(activity.externalSourceGroupId, linked);
  }
  for (const row of sourceHistory) {
    if (!row.snapshot || typeof row.snapshot !== "object") continue;
    const snapshot = row.snapshot as {
      groups?: Array<{ id: number }>;
      activities?: Array<{ groupId: number | null; actualProgress: number; weight: number }>;
    };
    const relevantGroups = new Set((snapshot.groups ?? [])
      .map(group => group.id)
      .filter(groupId => sourceProjectByGroup.get(groupId) === row.projectId && linkedActivitiesByGroup.has(groupId)));
    if (!relevantGroups.size) continue;
    const childrenByGroup = new Map<number, Array<{ actualProgress: number; weight: number }>>();
    for (const child of snapshot.activities ?? []) {
      if (child.groupId == null || !relevantGroups.has(child.groupId)) continue;
      const children = childrenByGroup.get(child.groupId) ?? [];
      children.push(child);
      childrenByGroup.set(child.groupId, children);
    }
    const date = tripoliDay(row.capturedAt);
    for (const groupId of relevantGroups) {
      const children = childrenByGroup.get(groupId) ?? [];
      const totalWeight = children.reduce((sum, child) =>
        sum + (Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1), 0);
      if (!children.length || !totalWeight) continue;
      const value = children.reduce((sum, child) => sum
        + child.actualProgress * (Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1), 0) / totalWeight;
      for (const activityId of linkedActivitiesByGroup.get(groupId) ?? []) {
        addHistoricalPoint(activityId, date, value);
      }
    }
  }

  const normalizedActivityInputs = [...activityInputs.values()].map(input => ({
    ...input,
    points: [...new Map(input.points.map(point => [point.date, point])).values()]
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const inputByActivity = new Map(normalizedActivityInputs.map(input => [input.activityId, input]));
  const verifiedByDate = new Map<string, number>();
  for (const row of history) {
    if (row.source !== "actual" || !row.snapshot || typeof row.snapshot !== "object") continue;
    const snapshotActivities = (row.snapshot as {
      activities?: Array<{
        id: number; actualProgress: number; weight: number; externalSourceGroupId: number | null;
      }>;
    }).activities ?? [];
    let weightedSum = 0, totalWeight = 0, complete = snapshotActivities.length > 0;
    for (const activity of snapshotActivities) {
      let progress = activity.actualProgress;
      if (activity.externalSourceGroupId != null) {
        const sourcePoint = latestPointOnOrBefore(
          inputByActivity.get(activity.id)?.points ?? [], tripoliDay(row.capturedAt),
        );
        if (!sourcePoint) { complete = false; break; }
        progress = sourcePoint.progress;
      }
      const weight = Number.isFinite(activity.weight) && activity.weight > 0 ? activity.weight : 1;
      weightedSum += progress * weight;
      totalWeight += weight;
    }
    if (complete && totalWeight) verifiedByDate.set(tripoliDay(row.capturedAt), weightedSum / totalWeight);
  }
  const verifiedProjectPoints = [
    ...[...verifiedByDate].map(([date, progress]) => ({ date, progress })),
    ...reportAnchors.filter(report => Number.isFinite(report.progressPercentage)).map(report => ({
      date: report.progressAsOfDate ?? report.periodEnd,
      progress: report.progressPercentage,
    })),
  ];
  const fingerprint = hash({
    project, activities, suspensions, groups,
    history: history.map(row => ({ id: row.id, capturedAt: row.capturedAt, source: row.source, snapshot: row.snapshot })),
    sourceHistory: sourceHistory.map(row => ({ projectId: row.projectId, capturedAt: row.capturedAt, source: row.source, snapshot: row.snapshot })),
    reportAnchors,
  });
  return {
    project, activities: activities as BackfillActivity[], suspensions: suspensions as BackfillSuspension[],
    batches, history, normalizedActivityInputs, reportAnchors, fingerprint,
    verifiedProjectPoints,
  };
}

function makePreview(
  state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>,
  input: BackfillInput,
  options: { includeSnapshots?: boolean } = {},
) {
  const inputs = new Map((input.activityInputs ?? []).map(row => [row.activityId, row]));
  const stateInputs = new Map(state.normalizedActivityInputs.map(row => [row.activityId, row]));
  const activities = state.activities.map(activity => {
    if (activity.externalSourceGroupId == null) return activity;
    const sourcePoints = stateInputs.get(activity.id)?.points ?? [];
    const latest = sourcePoints.filter(point => point.date <= input.realityDate).at(-1);
    return {
      ...activity,
      hasHistoricalSource: sourcePoints.some(point => point.date <= input.periodStart),
      ...(latest ? { historicalSourceProgress: latest.progress } : {}),
    };
  });
  const merged = {
    ...input,
    activityInputs: state.normalizedActivityInputs.map(row => ({
      ...row,
      ...inputs.get(row.activityId),
      points: row.points,
    })),
    verifiedProjectPoints: state.verifiedProjectPoints,
  };
  const result = previewHistoricalProgress(state.project, activities, state.suspensions, merged, options);
  const token = hash({ fingerprint: state.fingerprint, input: merged, methodology: result.methodology });
  return { result, token, merged };
}

function isSingleRestoreBurst(
  history: Array<{ capturedAt: Date; snapshot: unknown; source: string }>,
  activities: Array<{ id: number }>,
): boolean {
  if (history.length < 2 || activities.length === 0 || history.some(row => row.source !== "actual")) return false;
  const ordered = [...history].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  if (new Set(ordered.map(row => tripoliDay(row.capturedAt))).size !== 1) return false;
  const currentIds = new Set(activities.map(activity => activity.id));
  let previousIds = new Set<number>();
  for (let index = 0; index < ordered.length; index++) {
    const snapshot = ordered[index].snapshot;
    if (!snapshot || typeof snapshot !== "object") return false;
    const rows = (snapshot as { activities?: unknown }).activities;
    if (!Array.isArray(rows)) return false;
    const ids = new Set(rows.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return [];
      const id = (row as { id?: unknown }).id;
      return typeof id === "number" && Number.isSafeInteger(id) ? [id] : [];
    }));
    if (ids.size !== rows.length || [...ids].some(id => !currentIds.has(id))) return false;
    if (index === 0 && ids.size !== 0) return false;
    if ([...previousIds].some(id => !ids.has(id))) return false;
    previousIds = ids;
  }
  return previousIds.size === currentIds.size && [...currentIds].every(id => previousIds.has(id));
}

function makeAutomaticInput(state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>) {
  const realityDate = tripoliDay(new Date());
  const restoreBurstDetected = state.reportAnchors.length === 0
    && state.activities.every(activity => activity.externalSourceGroupId == null)
    && isSingleRestoreBurst(state.history, state.activities);
  const recordedProgress = new Set<number>();
  if (!restoreBurstDetected) {
    for (const input of state.normalizedActivityInputs) {
      if (input.points.some(point => point.date <= realityDate && point.progress > 0)) {
        recordedProgress.add(input.activityId);
      }
    }
  }
  for (const row of restoreBurstDetected ? [] : state.history) {
    if (tripoliDay(row.capturedAt) > realityDate || !row.snapshot || typeof row.snapshot !== "object") continue;
    const snapshotActivities = (row.snapshot as {
      activities?: Array<{ id?: number; actualProgress?: number }>;
    }).activities ?? [];
    for (const activity of snapshotActivities) {
      if (typeof activity.id === "number" && Number(activity.actualProgress) > 0) {
        recordedProgress.add(activity.id);
      }
    }
  }

  const candidates = state.activities.filter(activity =>
    Number.isFinite(activity.actualProgress) && activity.actualProgress > 0 && !recordedProgress.has(activity.id),
  );
  if (!candidates.length) {
    const hasCurrentProgress = state.activities.some(activity =>
      Number.isFinite(activity.actualProgress) && activity.actualProgress > 0,
    );
    return {
      error: hasCurrentProgress
        ? "كل البنود ذات التقدم الحالي لديها سجل تقدم مؤرخ؛ لن تُنشأ تقديرات مكررة."
        : "لا توجد بنود ذات تقدم حالي لتهيئتها.",
    } as const;
  }

  const candidatesWithStart = candidates.filter(activity =>
    validBackfillDay(activity.actualStartDate) && activity.actualStartDate <= realityDate,
  );
  if (!candidatesWithStart.length) {
    return { error: "لا يمكن إنشاء تقدير: البنود المتقدمة بلا تاريخ بداية فعلي صالح." } as const;
  }

  const periodStart = candidatesWithStart
    .map(activity => activity.actualStartDate!)
    .sort((a, b) => a.localeCompare(b))[0];
  const input: BackfillInput = {
    periodStart,
    realityDate,
    realityProgress: weightedProgress(state.activities.map(activity => ({
      actualProgress: activity.actualProgress,
      weight: activity.weight,
    }))),
    automatic: true,
    referencePoints: [],
  };
  return {
    input,
    candidates,
    candidatesWithStart,
    missingStartDateCount: candidates.length - candidatesWithStart.length,
    restoreBurstDetected,
  } as const;
}

router.post("/projects/:projectId/progress-history-backfill/automatic-preview", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const workEstimate = await estimateBackfillHistoryCells(projectId);
  if (workEstimate.historyCells > MAX_BACKFILL_HISTORY_CELLS) {
    res.status(413).json({ error: HISTORY_TOO_LARGE_ERROR }); return;
  }
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const plan = makeAutomaticInput(state);
  if ("error" in plan) { res.status(409).json({ error: plan.error }); return; }
  if (!isBackfillActivityDayWorkSafe(state.activities.length, periodDayCount(plan.input.periodStart, plan.input.realityDate))) {
    res.status(413).json({ error: PREVIEW_TOO_LARGE_ERROR }); return;
  }

  const { result, token } = makePreview(state, plan.input, { includeSnapshots: false });
  const occupiedDays = new Set(state.history.map(row => tripoliDay(row.capturedAt)));
  const snapshotsToSkip = [...occupiedDays].filter(date =>
    date >= plan.input.periodStart && date <= plan.input.realityDate).length;
  const availableActivityIds = new Set(result.availableActivityIds);
  const estimatedCandidateActivities = plan.candidates.filter(candidate =>
    availableActivityIds.has(candidate.id),
  ).length;
  const { snapshots: _snapshots, availableActivityIds: _availableActivityIds, ...summary } = result;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    ...summary,
    input: plan.input,
    previewToken: token,
    sourceFingerprint: state.fingerprint,
    candidateActivities: plan.candidates.length,
    candidatesWithStartDate: plan.candidatesWithStart.length,
    candidatesMissingStartDate: plan.missingStartDateCount,
    estimatedCandidateActivities,
    restoreBurstDetected: plan.restoreBurstDetected,
    snapshotsToAdd: Math.max(0, result.days - snapshotsToSkip),
    snapshotsToSkip,
  });
});

router.get("/projects/:projectId/progress-history-backfill", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const [project] = await db.select({
    name: projectsTable.name, startDate: projectsTable.startDate,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const [activities, batches] = await Promise.all([
    db.select({
      id: activitiesTable.id, name: activitiesTable.name, status: activitiesTable.status,
      actualProgress: activitiesTable.actualProgress, weight: activitiesTable.weight,
      actualStartDate: activitiesTable.actualStartDate, actualEndDate: activitiesTable.actualEndDate,
      externalSourceGroupId: activitiesTable.externalSourceGroupId,
    }).from(activitiesTable).where(eq(activitiesTable.projectId, projectId))
      .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id)),
    db.select({
      id: projectProgressHistoryBatchesTable.id,
      createdAt: projectProgressHistoryBatchesTable.createdAt,
      methodology: projectProgressHistoryBatchesTable.methodology,
      revertedAt: projectProgressHistoryBatchesTable.revertedAt,
    }).from(projectProgressHistoryBatchesTable)
      .where(eq(projectProgressHistoryBatchesTable.projectId, projectId))
      .orderBy(desc(projectProgressHistoryBatchesTable.createdAt)),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ project, activities, batches });
});

router.post("/projects/:projectId/progress-history-backfill/preview", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const input = asBackfillInput(req.body);
  if (!input) { res.status(400).json({ error: "مدخلات الفترة أو واقع الحال غير صالحة." }); return; }
  const workEstimate = await estimateBackfillHistoryCells(projectId);
  if (workEstimate.historyCells > MAX_BACKFILL_HISTORY_CELLS) {
    res.status(413).json({ error: HISTORY_TOO_LARGE_ERROR }); return;
  }
  if (!isBackfillActivityDayWorkSafe(workEstimate.activityCount, periodDayCount(input.periodStart, input.realityDate))) {
    res.status(413).json({ error: PREVIEW_TOO_LARGE_ERROR }); return;
  }
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const { result, token } = makePreview(state, input, { includeSnapshots: false });
  const occupiedDays = new Set(state.history.map(row => tripoliDay(row.capturedAt)));
  const snapshotsToSkip = [...occupiedDays].filter(date => date >= input.periodStart && date <= input.realityDate).length;
  const { snapshots: _snapshots, availableActivityIds: _availableActivityIds, ...summary } = result;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    ...summary, previewToken: token, sourceFingerprint: state.fingerprint,
    snapshotsToAdd: Math.max(0, result.days - snapshotsToSkip),
    snapshotsToSkip,
  });
});

router.post("/projects/:projectId/progress-history-backfill/commit", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const input = asBackfillInput(req.body?.input);
  const previewToken = req.body?.previewToken;
  if (!input || typeof previewToken !== "string") {
    res.status(400).json({ error: "أعد المعاينة قبل الاعتماد." }); return;
  }
  const workEstimate = await estimateBackfillHistoryCells(projectId);
  if (workEstimate.historyCells > MAX_BACKFILL_HISTORY_CELLS) {
    res.status(413).json({ error: HISTORY_TOO_LARGE_ERROR }); return;
  }
  if (!isBackfillActivityDayWorkSafe(workEstimate.activityCount, periodDayCount(input.periodStart, input.realityDate))) {
    res.status(413).json({ error: PREVIEW_TOO_LARGE_ERROR }); return;
  }
  const result = await db.transaction(async tx => {
    // Match automatic capture's lock to avoid importing over a concurrent actual snapshot.
    await tx.execute(lockSql);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(84621, ${projectId})`);
    const state = await readBackfillState(projectId);
    if (!state) return { kind: "missing" as const };
    if (!isBackfillActivityDayWorkSafe(state.activities.length, periodDayCount(input.periodStart, input.realityDate))) {
      return { kind: "too_large" as const };
    }
    const preview = makePreview(state, input);
    if (preview.token !== previewToken) return { kind: "changed" as const };
    if (!preview.result.valid) return { kind: "invalid" as const, conflicts: preview.result.conflicts };
    const fingerprint = hash({ projectId, input: preview.merged, methodology: historicalBackfillMethodology });
    const [existing] = await tx.select({ id: projectProgressHistoryBatchesTable.id })
      .from(projectProgressHistoryBatchesTable)
      .where(and(eq(projectProgressHistoryBatchesTable.projectId, projectId),
        eq(projectProgressHistoryBatchesTable.fingerprint, fingerprint)));
    if (existing) return { kind: "duplicate" as const };

    const [batch] = await tx.insert(projectProgressHistoryBatchesTable).values({
      projectId,
      fingerprint,
      methodology: historicalBackfillMethodology,
      periodStart: new Date(`${input.periodStart}T00:00:00+02:00`),
      periodEnd: new Date(`${input.realityDate}T00:00:00+02:00`),
      createdById: req.user!.userId,
    }).returning();
    const actualDays = new Set(state.history.filter(row => row.source === "actual")
      .map(row => tripoliDay(row.capturedAt)));
    const occupiedDays = new Set(state.history.map(row => tripoliDay(row.capturedAt)));
    const baseSnapshot = await buildProjectProgressSnapshot(projectId, tx);
    if (!baseSnapshot) throw new Error("المشروع غير موجود");
    let inserted = 0, skippedActual = 0, skippedExisting = 0;
    for (const snapshot of preview.result.snapshots) {
      if (actualDays.has(snapshot.date)) { skippedActual++; continue; }
      if (occupiedDays.has(snapshot.date)) { skippedExisting++; continue; }
      const fullSnapshot = structuredClone(baseSnapshot);
      const current = fullSnapshot as { activities: Array<Record<string, unknown>> };
      const estimatedById = new Map(snapshot.activities.map(activity => [activity.id, activity]));
      current.activities = current.activities.map(activity => {
        const estimate = estimatedById.get(Number(activity.id));
        if (!estimate) return activity;
        return {
          ...activity,
          actualProgress: estimate.actualProgress,
          status: estimate.status,
          actualHistoricalUnverified: estimate.actualHistoricalUnverified === true,
        };
      });
      await tx.insert(projectProgressHistoryTable).values({
        projectId,
        capturedAt: new Date(`${snapshot.date}T00:00:00+02:00`),
        snapshot: fullSnapshot,
        source: "estimated",
        importBatchId: batch.id,
        createdById: req.user!.userId,
        methodology: historicalBackfillMethodology,
      });
      inserted++;
    }
    return { kind: "created" as const, batch, inserted, skippedActual, skippedExisting };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  if (result.kind === "too_large") { res.status(413).json({ error: PREVIEW_TOO_LARGE_ERROR }); return; }
  if (result.kind === "changed") { res.status(409).json({ error: "تغيرت بيانات المشروع بعد المعاينة؛ أعد المعاينة." }); return; }
  if (result.kind === "invalid") { res.status(400).json({ error: result.conflicts.join(" ") }); return; }
  if (result.kind === "duplicate") { res.status(409).json({ error: "سبق إنشاء دفعة بهذه المدخلات؛ لا يمكن تكرارها." }); return; }
  res.status(201).json({
    batch: result.batch, inserted: result.inserted,
    skippedActual: result.skippedActual, skippedExisting: result.skippedExisting,
  });
});

router.post("/projects/:projectId/progress-history-backfill/batches/:batchId/revert", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId), batchId = Number(req.params.batchId);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) { res.status(400).json({ error: "رقم الدفعة غير صالح." }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(84620, 1)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(84621, ${projectId})`);
    const [batch] = await tx.select().from(projectProgressHistoryBatchesTable)
      .where(and(eq(projectProgressHistoryBatchesTable.id, batchId),
        eq(projectProgressHistoryBatchesTable.projectId, projectId)));
    if (!batch) return { kind: "missing" as const };
    if (batch.revertedAt) return { kind: "reverted" as const };
    const owned = await tx.select({
      id: projectProgressHistoryTable.id, projectId: projectProgressHistoryTable.projectId,
      source: projectProgressHistoryTable.source,
      importBatchId: projectProgressHistoryTable.importBatchId,
    }).from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.importBatchId, batchId));
    if (owned.some(row => row.projectId !== projectId || row.source !== "estimated" || row.importBatchId !== batchId)) {
      return { kind: "ownership" as const };
    }
    await tx.delete(projectProgressHistoryTable).where(and(
      eq(projectProgressHistoryTable.importBatchId, batchId),
      eq(projectProgressHistoryTable.projectId, projectId),
      eq(projectProgressHistoryTable.source, "estimated"),
    ));
    await tx.update(projectProgressHistoryBatchesTable).set({ revertedAt: new Date() })
      .where(and(eq(projectProgressHistoryBatchesTable.id, batchId),
        eq(projectProgressHistoryBatchesTable.projectId, projectId)));
    return { kind: "done" as const, removed: owned.length };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "الدفعة غير موجودة." }); return; }
  if (result.kind === "reverted") { res.status(409).json({ error: "سبق التراجع عن هذه الدفعة." }); return; }
  if (result.kind === "ownership") { res.status(409).json({ error: "تعذر إثبات ملكية كل سجلات الدفعة؛ لم يُحذف شيء." }); return; }
  res.json({ reverted: true, removed: result.removed });
});

export default router;
