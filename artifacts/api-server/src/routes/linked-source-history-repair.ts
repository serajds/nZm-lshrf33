import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  activitiesTable, activityGroupsTable, db, projectProgressHistoryBatchesTable,
  projectProgressHistoryTable, projectsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectManager } from "../middlewares/auth";
import { buildProjectProgressSnapshot } from "../lib/capture-project-progress-history";
import { historicalBackfillMethodology, previewHistoricalProgress, validBackfillDay } from "../lib/historical-progress-backfill";
import { makeAutomaticInput, makePreview, preparePreview, readBackfillState } from "./progress-history-backfill";

const router: IRouter = Router();
const LINKED_REPAIR_METHOD = `linked-source-repair-v1:${historicalBackfillMethodology}`;
const PAGE_SIZE = 10;
const MAX_LINKED_REPAIR_SNAPSHOTS = 3_000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function todayInTripoli(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function eachDay(start: string, end: string): string[] {
  if (!validBackfillDay(start) || !validBackfillDay(end) || start > end) return [];
  const result: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (result.length > 4000) throw new Error("الفترة المطلوبة طويلة جدًا للتهيئة.");
  }
  return result;
}

type SourceDefinition = {
  projectId: number;
  name: string;
  groups: Array<{ id: number; name: string }>;
};

async function listLinkedSources(parentProjectId: number): Promise<SourceDefinition[]> {
  const references = await db.select({ groupId: activitiesTable.externalSourceGroupId })
    .from(activitiesTable)
    .where(and(eq(activitiesTable.projectId, parentProjectId), isNotNull(activitiesTable.externalSourceGroupId)));
  const groupIds = [...new Set(references.map(row => row.groupId).filter((id): id is number => id != null))];
  if (!groupIds.length) return [];

  const groups = await db.select({
    id: activityGroupsTable.id, projectId: activityGroupsTable.projectId, name: activityGroupsTable.name,
  }).from(activityGroupsTable).where(inArray(activityGroupsTable.id, groupIds));
  const sourceIds = [...new Set(groups.map(group => group.projectId))];
  const projects = sourceIds.length
    ? await db.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable).where(inArray(projectsTable.id, sourceIds))
    : [];
  const nameByProject = new Map(projects.map(project => [project.id, project.name]));
  const groupsByProject = new Map<number, Array<{ id: number; name: string }>>();
  for (const group of groups) {
    const rows = groupsByProject.get(group.projectId) ?? [];
    rows.push({ id: group.id, name: group.name });
    groupsByProject.set(group.projectId, rows);
  }
  return [...groupsByProject].map(([projectId, sourceGroups]) => ({
    projectId,
    name: nameByProject.get(projectId) ?? `مشروع ${projectId}`,
    groups: sourceGroups.sort((a, b) => a.id - b.id),
  })).sort((a, b) => a.projectId - b.projectId);
}

function coverageForSource(
  state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>,
  source: SourceDefinition,
  periodEnd: string,
) {
  const latestEntry = [...state.latestSnapshotByDay.entries()]
    .filter(([date]) => date <= periodEnd)
    .sort(([left], [right]) => right.localeCompare(left))[0];
  const latestDate = latestEntry?.[0] ?? null;
  const latest = latestEntry?.[1] ?? null;
  const missingGroupIds = latest
    ? source.groups.filter(group => !latest.groupIds.has(group.id)).map(group => group.id)
    : source.groups.map(group => group.id);
  const relevantActivities = state.activities.filter(activity =>
    activity.groupId != null && source.groups.some(group => group.id === activity.groupId),
  );
  const unverifiedActivityIds = latest
    ? relevantActivities.filter(activity =>
      latest.unverifiedActivityIds.has(activity.id) || !latest.activityIds.has(activity.id),
    ).map(activity => activity.id)
    : [];
  return {
    latestDate,
    latestCapturedAt: latest?.capturedAt ?? null,
    latestSource: latest?.source ?? null,
    missingGroupIds,
    unverifiedActivityIds,
    relevantActivities,
    covered: !!latest && missingGroupIds.length === 0 && unverifiedActivityIds.length === 0,
  };
}

type PreparedSource = {
  source: SourceDefinition;
  state: NonNullable<Awaited<ReturnType<typeof readBackfillState>>>;
  input: Exclude<ReturnType<typeof makeAutomaticInput>, { error: string }>["input"];
  prepared: Awaited<ReturnType<typeof makePreview>>;
  coverage: ReturnType<typeof coverageForSource>;
  replaceDays: Set<string>;
  addCount: number;
  skippedActual: number;
  skippedExisting: number;
  warnings: string[];
  conflicts: string[];
};

async function buildRepairPreview(parentProjectId: number, periodEnd: string) {
  const sources = await listLinkedSources(parentProjectId);
  if (!sources.length) return { kind: "no_sources" as const };

  const sourceRows: Array<{
    source: SourceDefinition;
    status: "covered" | "repair" | "blocked";
    linkedGroups: number;
    missingGroups: number;
    unverifiedActivities: number;
    latestSnapshotAt: string | null;
    latestSource: "actual" | "estimated" | null;
    periodStart: string | null;
    realityDate: string | null;
    snapshotsToAdd: number;
    snapshotsToReplace: number;
    estimatedActivities: number;
    unavailableActivities: number;
    warnings: string[];
    conflicts: string[];
  }> = [];
  const plans: PreparedSource[] = [];
  const lockData: Array<{ sourceId: number; fingerprint: string; token: string; replaceDays: string[]; addCount: number }> = [];

  for (const source of sources) {
    const state = await readBackfillState(source.projectId);
    if (!state) {
      sourceRows.push({
        source, status: "blocked", linkedGroups: source.groups.length, missingGroups: source.groups.length,
        unverifiedActivities: 0, latestSnapshotAt: null, latestSource: null, periodStart: null, realityDate: null,
        snapshotsToAdd: 0, snapshotsToReplace: 0, estimatedActivities: 0, unavailableActivities: 0,
        warnings: [], conflicts: ["المشروع المصدر غير موجود."],
      });
      continue;
    }
    const coverage = coverageForSource(state, source, periodEnd);
    if (coverage.covered) {
      sourceRows.push({
        source, status: "covered", linkedGroups: source.groups.length, missingGroups: 0,
        unverifiedActivities: 0, latestSnapshotAt: coverage.latestCapturedAt?.toISOString() ?? null,
        latestSource: coverage.latestSource, periodStart: null, realityDate: null,
        snapshotsToAdd: 0, snapshotsToReplace: 0, estimatedActivities: 0, unavailableActivities: 0,
        warnings: [], conflicts: [],
      });
      lockData.push({ sourceId: source.projectId, fingerprint: state.fingerprint, token: "covered", replaceDays: [], addCount: 0 });
      continue;
    }

    const missingGroups = coverage.missingGroupIds.length;
    const conflicts: string[] = [];
    const warnings: string[] = [];
    if (coverage.latestSource === "actual" && coverage.latestDate === periodEnd) {
      conflicts.push("اللقطة الفعلية في تاريخ التقرير تحتوي فجوة؛ لم تُعدّل للمحافظة على السجل الفعلي.");
    }
    const automatic = makeAutomaticInput(state);
    if ("error" in automatic) {
      conflicts.push(automatic.error ?? "تعذّر تحديد نقاط تقديرية آمنة.");
      sourceRows.push({
        source, status: "blocked", linkedGroups: source.groups.length, missingGroups,
        unverifiedActivities: coverage.unverifiedActivityIds.length,
        latestSnapshotAt: coverage.latestCapturedAt?.toISOString() ?? null, latestSource: coverage.latestSource,
        periodStart: null, realityDate: null, snapshotsToAdd: 0, snapshotsToReplace: 0,
        estimatedActivities: 0, unavailableActivities: state.activities.length, warnings, conflicts,
      });
      lockData.push({ sourceId: source.projectId, fingerprint: state.fingerprint, token: "blocked", replaceDays: [], addCount: 0 });
      continue;
    }
    if (automatic.input.periodStart > periodEnd) {
      conflicts.push("بداية البيانات الحالية بعد تاريخ التقرير؛ لا يمكن تقدير حالة أسبق منها.");
    }
    let days: string[];
    try {
      days = eachDay(automatic.input.periodStart, automatic.input.realityDate);
    } catch {
      conflicts.push("الفترة التقديرية طويلة جدًا؛ لم يُجرَ أي تغيير.");
      sourceRows.push({
        source, status: "blocked", linkedGroups: source.groups.length, missingGroups,
        unverifiedActivities: coverage.unverifiedActivityIds.length,
        latestSnapshotAt: coverage.latestCapturedAt?.toISOString() ?? null, latestSource: coverage.latestSource,
        periodStart: automatic.input.periodStart, realityDate: automatic.input.realityDate,
        snapshotsToAdd: 0, snapshotsToReplace: 0, estimatedActivities: 0,
        unavailableActivities: state.activities.length, warnings, conflicts,
      });
      lockData.push({ sourceId: source.projectId, fingerprint: state.fingerprint, token: "blocked", replaceDays: [], addCount: 0 });
      continue;
    }

    let prepared: Awaited<ReturnType<typeof makePreview>>;
    try {
      prepared = await makePreview(state, automatic.input, { includeSnapshots: false });
    } catch (error) {
      conflicts.push(error instanceof Error ? error.message : "تعذّرت معاينة التقديرات.");
      sourceRows.push({
        source, status: "blocked", linkedGroups: source.groups.length, missingGroups,
        unverifiedActivities: coverage.unverifiedActivityIds.length,
        latestSnapshotAt: coverage.latestCapturedAt?.toISOString() ?? null, latestSource: coverage.latestSource,
        periodStart: automatic.input.periodStart, realityDate: automatic.input.realityDate, snapshotsToAdd: 0,
        snapshotsToReplace: 0, estimatedActivities: 0, unavailableActivities: state.activities.length, warnings, conflicts,
      });
      lockData.push({ sourceId: source.projectId, fingerprint: state.fingerprint, token: "blocked", replaceDays: [], addCount: 0 });
      continue;
    }
    warnings.push(...prepared.result.warnings);
    conflicts.push(...prepared.result.conflicts);

    const linkedActivityIds = new Set(coverage.relevantActivities.map(activity => activity.id));
    const availableIds = new Set(prepared.result.availableActivityIds);
    const unavailableLinkedActivities = coverage.relevantActivities.filter(activity => !availableIds.has(activity.id));
    if (unavailableLinkedActivities.length) {
      conflicts.push(`تعذّر تقدير ${unavailableLinkedActivities.length} بندًا من المجموعات المرتبطة.`);
    }

    const replaceDays = new Set<string>();
    for (const [date, latest] of state.latestSnapshotByDay) {
      if (date < automatic.input.periodStart || date > automatic.input.realityDate || latest.source !== "estimated") continue;
      const missingRelevantGroup = source.groups.some(group => !latest.groupIds.has(group.id));
      const missingRelevantActivity = [...linkedActivityIds].some(id => !latest.activityIds.has(id));
      const unverifiedRelevantActivity = [...latest.unverifiedActivityIds].some(id => linkedActivityIds.has(id));
      if (!missingRelevantGroup && !missingRelevantActivity && !unverifiedRelevantActivity) continue;
      if (state.actualHistoryDays.has(date)) {
        conflicts.push(`يوجد سجل فعلي في ${date}؛ لم يُستبدل حفاظًا عليه.`);
        continue;
      }
      replaceDays.add(date);
    }

    const addCount = days.filter(date =>
      !state.actualHistoryDays.has(date) && !state.historyDays.has(date) && !replaceDays.has(date),
    ).length;
    const skippedActual = days.filter(date => state.actualHistoryDays.has(date)).length;
    const skippedExisting = days.filter(date =>
      !state.actualHistoryDays.has(date) && state.historyDays.has(date) && !replaceDays.has(date),
    ).length;
    const status = conflicts.length ? "blocked" : "repair";
    sourceRows.push({
      source, status, linkedGroups: source.groups.length, missingGroups,
      unverifiedActivities: coverage.unverifiedActivityIds.length,
      latestSnapshotAt: coverage.latestCapturedAt?.toISOString() ?? null, latestSource: coverage.latestSource,
      periodStart: prepared.result.periodStart, realityDate: prepared.result.realityDate,
      snapshotsToAdd: addCount, snapshotsToReplace: replaceDays.size,
      estimatedActivities: prepared.result.estimatedActivities,
      unavailableActivities: prepared.result.unavailableActivities, warnings, conflicts,
    });
    if (status === "repair" && addCount + replaceDays.size > 0) {
      plans.push({
        source, state, input: automatic.input, prepared, coverage, replaceDays,
        addCount, skippedActual, skippedExisting, warnings, conflicts,
      });
    } else if (status === "repair") {
      sourceRows.at(-1)!.status = "blocked";
      sourceRows.at(-1)!.conflicts.push("لا توجد لقطات جديدة يمكن إضافتها أو تصحيحها.");
    }
    lockData.push({
      sourceId: source.projectId, fingerprint: state.fingerprint, token: prepared.token,
      replaceDays: [...replaceDays].sort(), addCount,
    });
  }

  const previewToken = hash({
    parentProjectId, periodEnd,
    links: sources.map(source => ({ projectId: source.projectId, groupIds: source.groups.map(group => group.id) })),
    sources: lockData,
  });
  const snapshotsToAdd = sourceRows.reduce((sum, source) => sum + source.snapshotsToAdd, 0);
  const snapshotsToReplace = sourceRows.reduce((sum, source) => sum + source.snapshotsToReplace, 0);
  if (snapshotsToAdd + snapshotsToReplace > MAX_LINKED_REPAIR_SNAPSHOTS) {
    for (const source of sourceRows) {
      if (source.status !== "repair") continue;
      source.status = "blocked";
      source.conflicts.push(`تتجاوز الخطة حد الأمان البالغ ${MAX_LINKED_REPAIR_SNAPSHOTS} لقطة؛ لم يُكتب أي سجل.`);
    }
    plans.length = 0;
  }
  const finalBlockedSources = sourceRows.filter(source => source.status === "blocked").length;
  return {
    kind: "ready" as const,
    valid: finalBlockedSources === 0,
    periodEnd, previewToken, sourceRows, plans, sources,
    snapshotsToAdd, snapshotsToReplace, blockedSources: finalBlockedSources,
  };
}

router.get(
  "/projects/:projectId/progress-history-backfill/linked-sources",
  requireProjectAccess("projectId"), requireProjectManager("projectId"),
  async (req, res): Promise<void> => {
    const sources = await listLinkedSources(Number(req.params.projectId));
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ hasLinkedSources: sources.length > 0 });
  },
);

router.post(
  "/projects/:projectId/progress-history-backfill/linked-sources/preview",
  requireProjectAccess("projectId"), requireProjectManager("projectId"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    const periodEnd = req.body?.periodEnd;
    if (!validBackfillDay(periodEnd) || periodEnd > todayInTripoli()) {
      res.status(400).json({ error: "تاريخ نهاية التقرير غير صالح." });
      return;
    }
    const preview = await buildRepairPreview(projectId, periodEnd);
    if (preview.kind === "no_sources") {
      res.status(409).json({ error: "لا توجد مجموعات مصادر مرتبطة بهذا المشروع." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({
      valid: preview.valid, periodEnd: preview.periodEnd, previewToken: preview.previewToken,
      sources: preview.sourceRows.map(({ source, ...row }) => ({ projectId: source.projectId, name: source.name, ...row })),
      snapshotsToAdd: preview.snapshotsToAdd, snapshotsToReplace: preview.snapshotsToReplace,
      blockedSources: preview.blockedSources,
    });
  },
);

router.post(
  "/projects/:projectId/progress-history-backfill/linked-sources/commit",
  requireProjectAccess("projectId"), requireProjectManager("projectId"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    const periodEnd = req.body?.periodEnd;
    const previewToken = req.body?.previewToken;
    if (!validBackfillDay(periodEnd) || periodEnd > todayInTripoli() || typeof previewToken !== "string") {
      res.status(400).json({ error: "أعد معاينة الإصلاح قبل التأكيد." });
      return;
    }

    type CommitResult =
      | { kind: "missing" | "no_sources" | "changed" | "invalid" | "duplicate" }
      | {
        kind: "created"; batchId: number; inserted: number; replaced: number; skippedActual: number;
        skippedExisting: number; sources: Array<{ projectId: number; name: string; inserted: number; replaced: number }>;
      };
    class InvalidRepair extends Error {}
    let result: CommitResult;
    try {
      result = await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(84620, 1)`);
        const initialSources = await listLinkedSources(projectId);
        for (const sourceId of [...new Set([projectId, ...initialSources.map(source => source.projectId)])].sort((a, b) => a - b)) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(84621, ${sourceId})`);
        }
        const preview = await buildRepairPreview(projectId, periodEnd);
        if (preview.kind === "no_sources") return { kind: "no_sources" as const };
        if (preview.previewToken !== previewToken) return { kind: "changed" as const };
        if (!preview.valid || !preview.plans.length) return { kind: "invalid" as const };

        const previousBatches = await tx.select({ id: projectProgressHistoryBatchesTable.id })
          .from(projectProgressHistoryBatchesTable)
          .where(eq(projectProgressHistoryBatchesTable.projectId, projectId));
        const fingerprint = hash({
          linkedRepairToken: preview.previewToken,
          generation: previousBatches.length,
          methodology: LINKED_REPAIR_METHOD,
        });
        const [duplicate] = await tx.select({ id: projectProgressHistoryBatchesTable.id })
          .from(projectProgressHistoryBatchesTable)
          .where(and(
            eq(projectProgressHistoryBatchesTable.projectId, projectId),
            eq(projectProgressHistoryBatchesTable.fingerprint, fingerprint),
          ));
        if (duplicate) return { kind: "duplicate" as const };

        const starts = preview.plans.map(plan => plan.input.periodStart).sort();
        const realityDate = preview.plans[0]?.input.realityDate;
        if (!realityDate || !starts[0]) return { kind: "invalid" as const };
        const [batch] = await tx.insert(projectProgressHistoryBatchesTable).values({
          projectId,
          fingerprint,
          methodology: LINKED_REPAIR_METHOD,
          periodStart: new Date(`${starts[0]}T00:00:00+02:00`),
          periodEnd: new Date(`${realityDate}T00:00:00+02:00`),
          createdById: req.user!.userId,
        }).returning({ id: projectProgressHistoryBatchesTable.id });

        let inserted = 0, replaced = 0, skippedActual = 0, skippedExisting = 0;
        const sourceResults: Array<{ projectId: number; name: string; inserted: number; replaced: number }> = [];
        for (const plan of preview.plans) {
          const baseSnapshot = await buildProjectProgressSnapshot(plan.source.projectId, tx);
          if (!baseSnapshot) throw new Error("المشروع المصدر غير موجود.");
          let sourceInserted = 0, sourceReplaced = 0;
          let pending: Array<typeof projectProgressHistoryTable.$inferInsert> = [];
          const flush = async () => {
            if (!pending.length) return;
            await tx.insert(projectProgressHistoryTable).values(pending);
            pending = [];
          };
          const generated = await previewHistoricalProgress(
            plan.state.project, plan.prepared.activities, plan.state.suspensions, plan.prepared.merged,
            {
              includeSnapshots: false,
              onSnapshot: async snapshot => {
                if (plan.state.actualHistoryDays.has(snapshot.date)) { skippedActual++; return; }
                const replaces = plan.replaceDays.has(snapshot.date);
                if (plan.state.historyDays.has(snapshot.date) && !replaces) { skippedExisting++; return; }
                const fullSnapshot = structuredClone(baseSnapshot) as {
                  activities: Array<Record<string, unknown>>;
                };
                const estimatedById = new Map(snapshot.activities.map(activity => [activity.id, activity]));
                fullSnapshot.activities = fullSnapshot.activities.map(activity => {
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
                  projectId: plan.source.projectId,
                  capturedAt: replaces
                    ? plan.state.latestSnapshotByDay.get(snapshot.date)?.capturedAt
                      ?? new Date(`${snapshot.date}T00:00:00+02:00`)
                    : new Date(`${snapshot.date}T00:00:00+02:00`),
                  snapshot: fullSnapshot,
                  source: "estimated",
                  importBatchId: batch.id,
                  createdById: req.user!.userId,
                  methodology: LINKED_REPAIR_METHOD,
                });
                if (replaces) sourceReplaced++;
                else sourceInserted++;
                if (pending.length >= PAGE_SIZE) await flush();
              },
            },
          );
          if (!generated.valid) throw new InvalidRepair(generated.conflicts.join(" "));
          await flush();
          inserted += sourceInserted;
          replaced += sourceReplaced;
          sourceResults.push({
            projectId: plan.source.projectId, name: plan.source.name,
            inserted: sourceInserted, replaced: sourceReplaced,
          });
        }
        return {
          kind: "created" as const, batchId: batch.id, inserted, replaced, skippedActual, skippedExisting,
          sources: sourceResults,
        };
      });
    } catch (error) {
      if (error instanceof InvalidRepair) {
        res.status(400).json({ error: error.message || "تغيّرت صلاحية التقديرات؛ لم يُحفظ شيء." });
        return;
      }
      throw error;
    }
    if (result.kind === "no_sources") { res.status(409).json({ error: "لا توجد مجموعات مصادر مرتبطة بهذا المشروع." }); return; }
    if (result.kind === "changed") { res.status(409).json({ error: "تغيّرت البيانات بعد المعاينة؛ أعد المعاينة قبل التأكيد." }); return; }
    if (result.kind === "invalid") { res.status(409).json({ error: "لا يمكن اعتماد المعاينة؛ لم يُحفظ أي تغيير." }); return; }
    if (result.kind === "duplicate") { res.status(409).json({ error: "سبق تنفيذ هذه المعاينة؛ لا يمكن تكرارها." }); return; }
    if (result.kind !== "created") { res.status(404).json({ error: "تعذّر العثور على مصادر قابلة للإصلاح." }); return; }
    res.status(201).json({
      batchId: result.batchId, inserted: result.inserted, replaced: result.replaced,
      skippedActual: result.skippedActual, skippedExisting: result.skippedExisting, sources: result.sources,
    });
  },
);

export default router;
