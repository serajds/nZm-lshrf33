import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  activitiesTable, activityGroupsTable, db, projectProgressHistoryBatchesTable,
  projectProgressHistoryTable, projectSuspensionsTable, projectsTable, reportsTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectManager } from "../middlewares/auth";
import { buildProjectProgressSnapshot } from "../lib/capture-project-progress-history";
import {
  historicalBackfillMethodology, previewHistoricalProgress, validBackfillDay, weightedProgress,
  type BackfillActivity, type BackfillDay, type BackfillInput, type BackfillSuspension,
} from "../lib/historical-progress-backfill";

const router: IRouter = Router();
const lockSql = sql`SELECT pg_advisory_xact_lock(84620, 1)`;
const MAX_BODY_POINTS = 500;
const HISTORY_PAGE_SIZE = 25;
const COMMIT_SNAPSHOT_BATCH_SIZE = 10;

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

  const fingerprintHash = createHash("sha256");
  const hashPart = (label: string, value: unknown) => {
    const encoded = stableJson(value);
    fingerprintHash.update(`${label}:${Buffer.byteLength(encoded)}:`).update(encoded).update("\n");
  };
  hashPart("project", project);
  hashPart("activities", activities);
  hashPart("suspensions", suspensions);
  hashPart("groups", groups);

  const activityPointMaps = new Map<number, Map<string, number>>();
  for (const activity of activities) activityPointMaps.set(activity.id, new Map());
  const externalSourceGroupByActivity = new Map(activities.map(activity => [activity.id, activity.externalSourceGroupId]));
  const addHistoricalPoint = (id: number, date: string, progress: unknown) => {
    const points = activityPointMaps.get(id);
    if (!points || !validBackfillDay(date) || !Number.isFinite(progress)
      || Number(progress) < 0 || Number(progress) > 100) return;
    points.set(date, Number(progress));
  };
  const historyDays = new Set<string>();
  const actualHistoryDays = new Set<string>();
  const recordedProgressDates = new Map<number, string>();
  let historyCount = 0;
  let restoreBurstCandidate = true;
  let restoreBurstDate: string | null = null;
  let restorePreviousIds = new Set<number>();
  const currentActivityIds = new Set(activities.map(activity => activity.id));
  const readHistoryPages = async (
    projectIds: number[],
    onRow: (row: {
      id: number; projectId: number; capturedAt: Date; snapshot: unknown; source: string;
    }) => Promise<void> | void,
  ) => {
    if (!projectIds.length) return;
    let cursor: { capturedAt: Date; id: number } | null = null;
    while (true) {
      const conditions = [inArray(projectProgressHistoryTable.projectId, projectIds)];
      if (cursor) conditions.push(or(
        gt(projectProgressHistoryTable.capturedAt, cursor.capturedAt),
        and(eq(projectProgressHistoryTable.capturedAt, cursor.capturedAt), gt(projectProgressHistoryTable.id, cursor.id)),
      )!);
      const page = await db.select({
        id: projectProgressHistoryTable.id,
        projectId: projectProgressHistoryTable.projectId,
        capturedAt: projectProgressHistoryTable.capturedAt,
        snapshot: projectProgressHistoryTable.snapshot,
        source: projectProgressHistoryTable.source,
      }).from(projectProgressHistoryTable).where(and(...conditions))
        .orderBy(asc(projectProgressHistoryTable.capturedAt), asc(projectProgressHistoryTable.id))
        .limit(HISTORY_PAGE_SIZE);
      if (!page.length) break;
      for (const row of page) await onRow(row);
      const last = page.at(-1)!;
      cursor = { capturedAt: last.capturedAt, id: last.id };
      if (page.length < HISTORY_PAGE_SIZE) break;
    }
  };
  const reportPoints: Array<{ date: string; progress: number }> = [];
  let reportAnchorCount = 0;

  const sourceProjectByGroup = new Map(sourceGroups.map(group => [group.id, group.projectId]));
  const linkedActivitiesByGroup = new Map<number, number[]>();
  for (const activity of activities) {
    if (activity.externalSourceGroupId == null) continue;
    const linked = linkedActivitiesByGroup.get(activity.externalSourceGroupId) ?? [];
    linked.push(activity.id);
    linkedActivitiesByGroup.set(activity.externalSourceGroupId, linked);
  }

  await readHistoryPages([projectId], row => {
    historyCount++;
    hashPart("history", row);
    const date = tripoliDay(row.capturedAt);
    historyDays.add(date);
    if (row.source === "actual") actualHistoryDays.add(date);
    const snapshot = row.snapshot && typeof row.snapshot === "object"
      ? row.snapshot as { activities?: Array<{ id?: number; actualProgress?: number }> }
      : null;
    const snapshotActivities = snapshot?.activities;
    if (!Array.isArray(snapshotActivities)) {
      restoreBurstCandidate = false;
      return;
    }
    const ids = new Set<number>();
    for (const activity of snapshotActivities) {
      if (typeof activity.id !== "number" || !Number.isSafeInteger(activity.id)) {
        restoreBurstCandidate = false;
        continue;
      }
      ids.add(activity.id);
      if (Number(activity.actualProgress) > 0
        && (!recordedProgressDates.has(activity.id) || date < recordedProgressDates.get(activity.id)!)) {
        recordedProgressDates.set(activity.id, date);
      }
      if (row.source === "actual" && externalSourceGroupByActivity.get(activity.id) == null) {
        addHistoricalPoint(activity.id, date, activity.actualProgress);
      }
    }
    if (row.source !== "actual" || ids.size !== snapshotActivities.length
      || (historyCount === 1 && ids.size !== 0)
      || [...ids].some(id => !currentActivityIds.has(id))
      || (restoreBurstDate != null && restoreBurstDate !== date)
      || [...restorePreviousIds].some(id => !ids.has(id))) restoreBurstCandidate = false;
    if (restoreBurstDate == null) restoreBurstDate = date;
    restorePreviousIds = ids;
  });
  let lastReportId = 0;
  while (true) {
    const reportPage = await db.select({
      id: reportsTable.id,
      periodEnd: reportsTable.periodEnd,
      progressAsOfDate: reportsTable.progressAsOfDate,
      progressPercentage: reportsTable.progressPercentage,
      activitiesSnapshot: reportsTable.activitiesSnapshot,
    }).from(reportsTable).where(and(
      eq(reportsTable.projectId, projectId),
      eq(reportsTable.progressSource, "history"),
      gt(reportsTable.id, lastReportId),
    )).orderBy(asc(reportsTable.id)).limit(HISTORY_PAGE_SIZE);
    if (!reportPage.length) break;
    for (const report of reportPage) {
      reportAnchorCount++;
      const { id, ...anchor } = report;
      hashPart("report", { id, ...anchor });
      const date = report.progressAsOfDate ?? report.periodEnd;
      if (Number.isFinite(report.progressPercentage)) {
        reportPoints.push({ date, progress: report.progressPercentage });
      }
      if (Array.isArray(report.activitiesSnapshot)) {
        for (const row of report.activitiesSnapshot as Array<{
          id?: number; actualProgress?: number; actualHistoricalUnverified?: boolean;
        }>) {
          if (typeof row.id === "number" && row.actualHistoricalUnverified !== true
            && externalSourceGroupByActivity.get(row.id) == null) {
            addHistoricalPoint(row.id, date, row.actualProgress);
          }
        }
      }
    }
    lastReportId = reportPage.at(-1)!.id;
    if (reportPage.length < HISTORY_PAGE_SIZE) break;
  }
  const restoreBurstDetected = restoreBurstCandidate && historyCount >= 2
    && activities.length > 0
    && activities.every(activity => restorePreviousIds.has(activity.id))
    && restorePreviousIds.size === activities.length;

  await readHistoryPages(sourceProjectIds, row => {
    hashPart("source-history", row);
    if (!row.snapshot || typeof row.snapshot !== "object") return;
    const snapshot = row.snapshot as {
      groups?: Array<{ id: number }>;
      activities?: Array<{ groupId: number | null; actualProgress: number; weight: number }>;
    };
    const relevantGroups = new Set((snapshot.groups ?? [])
      .map(group => group.id)
      .filter(groupId => sourceProjectByGroup.get(groupId) === row.projectId && linkedActivitiesByGroup.has(groupId)));
    if (!relevantGroups.size) return;
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
  });

  const normalizedActivityInputs = [...activityPointMaps].map(([activityId, points]) => ({
    activityId,
    points: [...points].map(([date, progress]) => ({ date, progress }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const inputByActivity = new Map(normalizedActivityInputs.map(input => [input.activityId, input]));
  const verifiedByDate = new Map<string, { progress: number; capturedAt: Date }>();
  await readHistoryPages([projectId], row => {
    if (row.source !== "actual" || !row.snapshot || typeof row.snapshot !== "object") return;
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
    const date = tripoliDay(row.capturedAt);
    if (complete && totalWeight) verifiedByDate.set(date, {
      progress: weightedSum / totalWeight, capturedAt: row.capturedAt,
    });
  });
  const verifiedProjectPoints = [
    ...[...verifiedByDate].map(([date, value]) => ({ date, progress: value.progress })),
    ...reportPoints,
  ];
  const fingerprint = fingerprintHash.digest("hex");
  return {
    project, activities: activities as BackfillActivity[], suspensions: suspensions as BackfillSuspension[],
    batches, historyDays, actualHistoryDays, historyCount, recordedProgressDates, restoreBurstDetected,
    normalizedActivityInputs, reportAnchorCount, fingerprint,
    verifiedProjectPoints,
  };
}

function preparePreview(
  state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>,
  input: BackfillInput,
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
  const token = hash({ fingerprint: state.fingerprint, input: merged, methodology: historicalBackfillMethodology });
  return { activities, merged, token };
}

async function makePreview(
  state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>,
  input: BackfillInput,
  options: {
    includeSnapshots?: boolean;
    onSnapshot?: (snapshot: BackfillDay) => Promise<void>;
  } = {},
) {
  const prepared = preparePreview(state, input);
  const result = await previewHistoricalProgress(
    state.project, prepared.activities, state.suspensions, prepared.merged, options,
  );
  return { ...prepared, result };
}

function makeAutomaticInput(state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>) {
  const realityDate = tripoliDay(new Date());
  const restoreBurstDetected = state.reportAnchorCount === 0
    && state.activities.every(activity => activity.externalSourceGroupId == null)
    && state.restoreBurstDetected;
  const recordedProgress = new Set<number>();
  if (!restoreBurstDetected) {
    for (const input of state.normalizedActivityInputs) {
      if (input.points.some(point => point.date <= realityDate && point.progress > 0)) {
        recordedProgress.add(input.activityId);
      }
    }
  }
  if (!restoreBurstDetected) {
    for (const [activityId, date] of state.recordedProgressDates) {
      if (date <= realityDate) recordedProgress.add(activityId);
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
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const plan = makeAutomaticInput(state);
  if ("error" in plan) { res.status(409).json({ error: plan.error }); return; }

  const { result, token } = await makePreview(state, plan.input, { includeSnapshots: false });
  const snapshotsToSkip = [...state.historyDays].filter(date =>
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
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const { result, token } = await makePreview(state, input, { includeSnapshots: false });
  const snapshotsToSkip = [...state.historyDays].filter(date => date >= input.periodStart && date <= input.realityDate).length;
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
  type CommitResult =
    | { kind: "missing" }
    | { kind: "changed" }
    | { kind: "duplicate" }
    | { kind: "invalid"; conflicts: string[] }
    | { kind: "created"; batch: typeof projectProgressHistoryBatchesTable.$inferSelect; inserted: number; skippedActual: number; skippedExisting: number };
  class InvalidBackfillPreview extends Error {
    constructor(readonly conflicts: string[]) { super("Invalid historical preview"); }
  }
  let result: CommitResult;
  try {
    result = await db.transaction(async tx => {
      // Match automatic capture's lock to avoid importing over a concurrent actual snapshot.
      await tx.execute(lockSql);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(84621, ${projectId})`);
      const state = await readBackfillState(projectId);
      if (!state) return { kind: "missing" as const };
      const prepared = preparePreview(state, input);
      if (prepared.token !== previewToken) return { kind: "changed" as const };
      const fingerprint = hash({ projectId, input: prepared.merged, methodology: historicalBackfillMethodology });
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
      const actualDays = state.actualHistoryDays;
      const occupiedDays = state.historyDays;
      const baseSnapshot = await buildProjectProgressSnapshot(projectId, tx);
      if (!baseSnapshot) throw new Error("المشروع غير موجود");
      let inserted = 0, skippedActual = 0, skippedExisting = 0;
      let pending: Array<typeof projectProgressHistoryTable.$inferInsert> = [];
      const flush = async () => {
        if (!pending.length) return;
        await tx.insert(projectProgressHistoryTable).values(pending);
        inserted += pending.length;
        pending = [];
      };
      const preview = await previewHistoricalProgress(
        state.project, prepared.activities, state.suspensions, prepared.merged,
        {
          includeSnapshots: false,
          onSnapshot: async snapshot => {
            if (actualDays.has(snapshot.date)) { skippedActual++; return; }
            if (occupiedDays.has(snapshot.date)) { skippedExisting++; return; }
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
            pending.push({
              projectId,
              capturedAt: new Date(`${snapshot.date}T00:00:00+02:00`),
              snapshot: fullSnapshot,
              source: "estimated",
              importBatchId: batch.id,
              createdById: req.user!.userId,
              methodology: historicalBackfillMethodology,
            });
            if (pending.length >= COMMIT_SNAPSHOT_BATCH_SIZE) await flush();
          },
        },
      );
      if (!preview.valid) throw new InvalidBackfillPreview(preview.conflicts);
      await flush();
      return { kind: "created" as const, batch, inserted, skippedActual, skippedExisting };
    });
  } catch (error) {
    if (error instanceof InvalidBackfillPreview) {
      result = { kind: "invalid", conflicts: error.conflicts };
    } else {
      throw error;
    }
  }
  if (result.kind === "missing") { res.status(404).json({ error: "المشروع غير موجود" }); return; }
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
