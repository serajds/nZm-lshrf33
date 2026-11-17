import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/historical-progress-backfill.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const {
  previewHistoricalProgress,
  validBackfillDay,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`,
);

const project = { startDate: "2026-01-01", noSchedule: false };
const activities = [
  { id: 1, name: "مكتمل", status: "completed", actualProgress: 100, weight: 1,
    actualStartDate: "2026-01-01", actualEndDate: "2026-03-10", externalSourceGroupId: null },
  { id: 2, name: "جارٍ", status: "in_progress", actualProgress: 40, weight: 2,
    actualStartDate: "2026-02-01", actualEndDate: null, externalSourceGroupId: null },
  { id: 3, name: "لم يبدأ", status: "not_started", actualProgress: 0, weight: 1,
    actualStartDate: null, actualEndDate: null, externalSourceGroupId: null },
  { id: 4, name: "مرتبط", status: "in_progress", actualProgress: 25, weight: 1,
    actualStartDate: null, actualEndDate: null, externalSourceGroupId: 90,
    hasHistoricalSource: true, historicalSourceProgress: 25 },
];
const input = {
  periodStart: "2026-01-01", realityDate: "2026-04-01", realityProgress: 41,
  activityInputs: [
    { activityId: 2, points: [{ date: "2026-01-01", progress: 0 }, { date: "2026-03-01", progress: 20 }] },
    { activityId: 4, points: [{ date: "2026-01-01", progress: 0 }, { date: "2026-04-01", progress: 25 }] },
  ],
  referencePoints: [{ date: "2026-03-01", progress: 35 }],
};

test("reconstructs completed, active, not-started and historically linked items", async () => {
  const preview = await previewHistoricalProgress(project, activities, [{
    type: "official_holiday", startDate: "2026-02-10", endDate: "2026-02-12", approvedBy: "مدير المشروع",
  }], input);
  assert.equal(preview.valid, true);
  assert.equal(preview.estimatedActivities, 4);
  assert.equal(preview.unavailableActivities, 0);
  const day = preview.snapshots.find(item => item.date === "2026-03-01");
  assert.equal(day.activities[2].actualProgress, 0);
  assert.ok(Math.abs(day.progress - 35) < 0.2, "reviewed project anchor is respected");
  assert.deepEqual(preview.excludedDays, ["2026-02-10", "2026-02-11", "2026-02-12"]);
  assert.equal(preview.snapshots.at(-1).progress, 41);
});

test("keeps preview summaries bounded without retaining daily snapshots", async () => {
  const full = await previewHistoricalProgress(project, activities, [], input);
  const summary = await previewHistoricalProgress(project, activities, [], input, { includeSnapshots: false });
  assert.equal(summary.snapshots.length, 0);
  assert.equal(summary.days, full.days);
  assert.equal(summary.valid, full.valid);
  assert.deepEqual(summary.samples, full.samples);
  assert.deepEqual(summary.availableActivityIds, full.availableActivityIds);
});

test("streams summaries when reconstruction exceeds the former activity-day budget", async () => {
  const manyActivities = Array.from({ length: 560 }, (_, index) => ({
    id: index + 1, name: `بند ${index + 1}`, status: "not_started", actualProgress: 0,
    weight: 1, actualStartDate: null, actualEndDate: null, externalSourceGroupId: null,
  }));
  let streamedDays = 0;
  const summary = await previewHistoricalProgress(
    project, manyActivities, [], {
      periodStart: "2025-01-01", realityDate: "2026-05-15", realityProgress: 0,
    }, {
      includeSnapshots: false,
      onSnapshot: async () => { streamedDays++; },
    },
  );
  assert.equal(summary.valid, true);
  assert.equal(summary.days, 500);
  assert.equal(manyActivities.length * summary.days > 250_000, true);
  assert.equal(summary.snapshots.length, 0);
  assert.equal(streamedDays, summary.days);
});

test("does not use the planned start or guess a completed item's missing end", async () => {
  const missingStart = { ...activities[1], actualStartDate: null };
  const missingEnd = { ...activities[0], actualEndDate: null };
  const preview = await previewHistoricalProgress(project, [missingStart, missingEnd], [], {
    periodStart: "2026-01-01", realityDate: "2026-04-01", realityProgress: 70,
  });
  assert.equal(preview.unavailableActivities, 2);
  assert.ok(preview.warnings.some(message => message.includes("لن تُستخدم البداية المخططة")));
  assert.ok(preview.warnings.some(message => message.includes("لن يُخمن النظام نهايته")));
});

test("automatic estimate reaches today's completion without inventing an actual end date", async () => {
  const completedWithoutEnd = { ...activities[0], actualEndDate: null };
  const preview = await previewHistoricalProgress(project, [completedWithoutEnd], [], {
    periodStart: "2026-01-01",
    realityDate: "2026-04-01",
    realityProgress: 100,
    automatic: true,
  });
  assert.equal(preview.valid, true);
  assert.equal(preview.unavailableActivities, 0);
  assert.equal(preview.snapshots.at(-1).activities[0].actualProgress, 100);
  assert.equal(preview.snapshots.at(-1).activities[0].actualEndDate, null);
});

test("linked items without a dated source remain unverified", async () => {
  const linked = { ...activities[3], hasHistoricalSource: false };
  const preview = await previewHistoricalProgress(project, [linked], [], {
    periodStart: "2026-01-01", realityDate: "2026-04-01", realityProgress: 25,
  });
  assert.equal(preview.unavailableActivities, 1);
  assert.equal(preview.snapshots.at(-1).activities[0].actualHistoricalUnverified, true);
});

test("accepts a one-day range and rejects invalid calendar boundaries", async () => {
  assert.equal(validBackfillDay("2026-02-28"), true);
  assert.equal(validBackfillDay("2026-02-29"), false);
  const oneDay = await previewHistoricalProgress(project, [activities[2]], [], {
    periodStart: "2026-04-01", realityDate: "2026-04-01", realityProgress: 0,
  });
  assert.equal(oneDay.valid, true);
  assert.equal(oneDay.days, 1);
});

test("invalid or contradictory reference points block approval", async () => {
  const preview = await previewHistoricalProgress(project, activities, [], {
    ...input,
    referencePoints: [
      { date: "2026-03-15", progress: 60 },
      { date: "2026-03-01", progress: 30 },
    ],
  });
  assert.equal(preview.valid, false);
  assert.ok(preview.conflicts.length > 0);
  const conflictsWithVerifiedPoint = await previewHistoricalProgress(project, activities, [], {
    ...input,
    referencePoints: [{ date: "2026-03-01", progress: 35 }],
    verifiedProjectPoints: [{ date: "2026-03-01", progress: 30 }],
  });
  assert.equal(conflictsWithVerifiedPoint.valid, false);
  assert.ok(conflictsWithVerifiedPoint.conflicts.some(message => message.includes("تتعارض النقاط المرجعية")));
});
