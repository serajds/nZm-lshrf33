import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the pure history resolver; DB queries use dated fixtures, never live data.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-period-progress.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{
    name: "history-fixtures",
    setup(b) {
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: "export const pool = { query: (...args) => globalThis.historyTestQuery(...args) };",
      }));
    },
  }],
});
const {
  weightedHistoryProgress, validReportDay, periodCutoff,
  resolveHistoricalActivities, getReportPeriodProgress,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

const activity = (id, progress, weight = 1, extra = {}) => ({
  id, name: `activity ${id}`, groupId: null,
  actualProgress: progress, plannedProgress: 0, weight,
  plannedStartDate: "2026-10-01", plannedEndDate: "2026-10-31",
  actualStartDate: null, actualEndDate: null,
  externalSourceGroupId: null, sortOrder: id,
  status: progress === 0 ? "not_started" : "in_progress", ...extra,
});
const project = (projectId, activities, extra = {}) => ({
  projectId, activities, groups: [], noSchedule: false,
  startDate: "2026-10-01", expectedEndDate: "2026-10-31", ...extra,
});
const row = (snapshot, capturedAt) => ({ project_id: snapshot.projectId, snapshot, captured_at: new Date(capturedAt) });
const now = new Date("2026-10-24T15:00:00Z");
function history(rows) {
  globalThis.historyTestQuery = async (sql, params) => {
    if (sql.includes("min(captured_at)")) {
      const target = rows.filter(r => r.project_id === params[0]).sort((a, b) => a.captured_at - b.captured_at);
      return { rows: [{ started_at: target[0]?.captured_at ?? null }] };
    }
    const latest = new Map();
    for (const r of rows.filter(r => r.captured_at < params[0]).sort((a, b) => a.captured_at - b.captured_at)) latest.set(r.project_id, r);
    return { rows: [...latest.values()] };
  };
}

test("weighted cumulative progress includes not-started activities and uses stored weights", () => {
  assert.equal(weightedHistoryProgress([activity(1, 100), activity(2, 0, 3)]), 25);
  assert.equal(weightedHistoryProgress([]), 0);
});

test("calendar validation and Libya end-of-day exclude the next calendar day", () => {
  assert(validReportDay("2024-02-29"));
  for (const day of ["2026-02-29", "2026-13-01", "x", "2026-1-01"]) assert(!validReportDay(day));
  assert.equal(periodCutoff("2026-10-20").toISOString(), "2026-10-20T22:00:00.000Z");
});

test("older report uses historical activity values, weights and membership, not today's state", async () => {
  history([
    row(project(1, [activity(1, 20), activity(2, 0)]), "2026-10-20T10:00:00Z"),
    row(project(1, [activity(1, 90, 5)]), "2026-10-24T10:00:00Z"),
  ]);
  const past = await getReportPeriodProgress(1, "2026-10-20", now);
  assert.equal(past.overallProgress, 10);
  assert.equal(past.activities.length, 2);
  assert.equal(past.activities[0].weight, 1);
  assert.equal(past.activities[0].plannedAsOfDate, "2026-10-20");
  assert.equal(past.variance, Math.round((past.overallProgress - past.plannedProgress) * 10) / 10);
  const current = await getReportPeriodProgress(1, "2026-10-24", now);
  assert.equal(current.overallProgress, 90);
  assert.notEqual(current.fingerprint, past.fingerprint);
});

test("linked progress resolves from the source's historical group including zero-progress children", async () => {
  history([
    row(project(1, [activity(1, 99, 2, { externalSourceGroupId: 40 })]), "2026-10-20T10:00:00Z"),
    row(project(2, [activity(2, 40, 1, { groupId: 40 }), activity(3, 0, 3, { groupId: 40 })],
      { groups: [{ id: 40, name: "source" }] }), "2026-10-20T11:00:00Z"),
    row(project(2, [activity(2, 100, 1, { groupId: 40 })],
      { groups: [{ id: 40, name: "source" }] }), "2026-10-24T11:00:00Z"),
  ]);
  const past = await getReportPeriodProgress(1, "2026-10-20", now);
  assert.equal(past.overallProgress, 10);
  assert.equal(past.activities[0].externalSourceGroupId, 40);
});

test("no history and future periods return unavailable, never today's progress or synthetic zero", async () => {
  history([row(project(1, [activity(1, 75)]), "2026-10-24T10:00:00Z")]);
  for (const day of ["2026-10-01", "2026-10-25"]) {
    const result = await getReportPeriodProgress(1, day, now);
    assert.equal(result.available, false);
    assert.equal(result.overallProgress, null);
    assert.equal(result.activities, null);
  }
});

test("an update at Libya midnight belongs to the following period", async () => {
  history([
    row(project(1, [activity(1, 20)]), "2026-10-20T21:59:59Z"),
    row(project(1, [activity(1, 80)]), "2026-10-20T22:00:00Z"),
  ]);
  assert.equal((await getReportPeriodProgress(1, "2026-10-20", now)).overallProgress, 20);
  assert.equal((await getReportPeriodProgress(1, "2026-10-21", now)).overallProgress, 80);
});

test("projects without a schedule have no historical planned/variance/SPI", async () => {
  history([row(project(1, [activity(1, 40)], { noSchedule: true }), "2026-10-20T10:00:00Z")]);
  const result = await getReportPeriodProgress(1, "2026-10-20", now);
  assert.equal(result.plannedProgress, null);
  assert.equal(result.variance, null);
  assert.equal(result.spi, null);
});

test("corrupt source cycles cannot recurse forever or read live sources", () => {
  const p = project(1, [activity(1, 30, 1, { groupId: 5, externalSourceGroupId: 5 })],
    { groups: [{ id: 5, name: "cycle" }] });
  assert.equal(resolveHistoricalActivities(p, [p], "2026-10-20")[0].actualProgress, 30);
});

test("missing historical source keeps last actual values but does not invent planned variance", async () => {
  history([row(project(1, [activity(1, 30, 1, { externalSourceGroupId: 999 })]), "2026-10-20T10:00:00Z")]);
  const result = await getReportPeriodProgress(1, "2026-10-20", now);
  assert.equal(result.overallProgress, 30);
  assert.equal(result.plannedProgress, null);
  assert.equal(result.spi, null);
});
