import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  activitiesTable, activityGroupsTable, db, projectProgressHistoryBatchesTable,
  projectProgressHistoryTable, projectSuspensionsTable, projectsTable, reportsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectManager } from "../middlewares/auth";
import { buildProjectProgressSnapshot } from "../lib/capture-project-progress-history";
import {
  historicalBackfillMethodology, previewHistoricalProgress, validBackfillDay,
  type BackfillActivity, type BackfillInput, type BackfillSuspension,
} from "../lib/historical-progress-backfill";

const router: IRouter = Router();
const lockSql = sql`SELECT pg_advisory_xact_lock(84620, 1)`;
const MAX_BODY_POINTS = 500;

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
      if (activities.find(item => item.id === activity.id)?.externalSourceGroupId == null) {
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
  for (const activity of activities.filter(item => item.externalSourceGroupId != null)) {
    const groupId = activity.externalSourceGroupId!;
    const sourceProjectId = sourceProjectByGroup.get(groupId);
    if (sourceProjectId == null) continue;
    for (const row of sourceHistory) {
      if (row.projectId !== sourceProjectId || !row.snapshot || typeof row.snapshot !== "object") continue;
      const snapshot = row.snapshot as {
        groups?: Array<{ id: number }>;
        activities?: Array<{ groupId: number | null; actualProgress: number; weight: number }>;
      };
      if (!(snapshot.groups ?? []).some(group => group.id === groupId)) continue;
      const children = (snapshot.activities ?? []).filter(child => child.groupId === groupId);
      const totalWeight = children.reduce((sum, child) =>
        sum + (Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1), 0);
      if (!children.length || !totalWeight) continue;
      const value = children.reduce((sum, child) => sum
        + child.actualProgress * (Number.isFinite(child.weight) && child.weight > 0 ? child.weight : 1), 0) / totalWeight;
      addHistoricalPoint(activity.id, tripoliDay(row.capturedAt), value);
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
        const sourcePoint = inputByActivity.get(activity.id)?.points
          .filter(point => point.date <= tripoliDay(row.capturedAt)).at(-1);
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
    batches, history, normalizedActivityInputs, fingerprint,
    verifiedProjectPoints,
  };
}

function makePreview(state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>, input: BackfillInput) {
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
  const result = previewHistoricalProgress(state.project, activities, state.suspensions, merged);
  const token = hash({ fingerprint: state.fingerprint, input: merged, methodology: result.methodology });
  return { result, token, merged };
}

router.get("/projects/:projectId/progress-history-backfill", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    project: state.project,
    activities: state.activities,
    batches: state.batches,
    fingerprint: state.fingerprint,
  });
});

router.post("/projects/:projectId/progress-history-backfill/preview", requireProjectAccess("projectId"), requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const input = asBackfillInput(req.body);
  if (!input) { res.status(400).json({ error: "مدخلات الفترة أو واقع الحال غير صالحة." }); return; }
  const state = await readBackfillState(projectId);
  if (!state) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
  const { result, token } = makePreview(state, input);
  const occupiedDays = new Set(state.history.map(row => tripoliDay(row.capturedAt)));
  const snapshotsToSkip = result.snapshots.filter(snapshot => occupiedDays.has(snapshot.date)).length;
  const { snapshots: _snapshots, ...summary } = result;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    ...summary, previewToken: token, sourceFingerprint: state.fingerprint,
    snapshotsToAdd: Math.max(0, result.snapshots.length - snapshotsToSkip),
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
  const result = await db.transaction(async tx => {
    // Match automatic capture's lock to avoid importing over a concurrent actual snapshot.
    await tx.execute(lockSql);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(84621, ${projectId})`);
    const state = await readBackfillState(projectId);
    if (!state) return { kind: "missing" as const };
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
