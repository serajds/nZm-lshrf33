import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { build } = require("esbuild");
async function compiled(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { analyzeActivities, analyzeTime, analyzeSuspensions, deviationStatus } =
  await compiled("artifacts/api-server/src/lib/deviation-analysis.ts");
const { buildDeviationHistory } = await compiled("artifacts/api-server/src/lib/deviation-history.ts");
const date = new Date("2026-01-06T20:00:00Z");
const project = (id = 1, extra = {}) => ({
  id, name: `Project ${id}`, noSchedule: false,
  startDate: "2026-01-01", expectedEndDate: "2026-01-11", ...extra,
});
const activity = (id, actualProgress, weight = 1, extra = {}) => ({
  id, projectId: 1, name: `Item ${id}`, groupId: null, weight, actualProgress,
  plannedProgress: 50, plannedStartDate: "2026-01-01", plannedEndDate: "2026-01-11",
  externalSourceGroupId: null, ...extra,
});
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
function analyze(activities, groups = [], projects = [project()], readable = [1, 2, 3]) {
  return analyzeActivities(projects[0], { activities, groups, projects }, new Set(readable), date);
}
const sourceGroup = { id: 20, projectId: 2, name: "Source group" };
function mixed() {
  return [
    activity(1, 20, 3), activity(2, 99, 1, { externalSourceGroupId: 20 }),
    activity(3, 0, 1, { projectId: 2, groupId: 20 }),
    activity(4, 40, 3, { projectId: 2, groupId: 20 }),
  ];
}

test("manual local reference: zeros remain in denominator and sign is actual minus planned", () => {
  const result = analyze([activity(1, 20, 3), activity(2, 0)]);
  close(result.actualProgress, 15); close(result.plannedProgress, 50); close(result.progressDeviation, -35);
  assert.deepEqual(result.activitiesAnalysis.map(a => a.weightedImpact), [-22.5, -12.5]);
});
test("mixed reference: target retains its own weight; details partition but never add rows", () => {
  const result = analyze(mixed(), [sourceGroup], [project(), project(2)]);
  close(result.actualProgress, 22.5); close(result.progressDeviation, -27.5);
  assert.equal(result.activitiesAnalysis.length, 2);
  const linked = result.activitiesAnalysis[1];
  assert.equal(linked.actualProgress, 30); assert.equal(linked.effectiveWeight, 25);
  assert.deepEqual(linked.sourceDetails.map(a => a.effectiveWeight), [6.25, 18.75]);
  assert.deepEqual(linked.sourceDetails.map(a => a.weightedImpact), [-3.125, -1.875]);
  close(linked.sourceDetails.reduce((s, a) => s + a.weightedImpact, 0), linked.weightedImpact);
});
test("nested and converging sources resolve once per value and retain each target allocation", () => {
  const rows = mixed();
  rows[3].externalSourceGroupId = 30;
  rows.push(activity(5, 80, 1, { projectId: 3, groupId: 30 }),
    activity(6, 0, 1, { projectId: 3, groupId: 30 }));
  rows.push(activity(7, 0, 2, { externalSourceGroupId: 30 }));
  const result = analyze(rows, [sourceGroup, { id: 30, projectId: 3, name: "Deep" }], [project(), project(2), project(3)]);
  close(result.actualProgress, (20 * 3 + 30 + 40 * 2) / 6);
  const linked = result.activitiesAnalysis.find(a => a.activityId === 2);
  close(linked.sourceDetails[1].children.reduce((s, a) => s + a.weightedImpact, 0), linked.sourceDetails[1].weightedImpact);
  close(result.activitiesAnalysis.reduce((s, a) => s + a.weightedImpact, 0), result.progressDeviation);
});
test("deleted group or project preserves stored values and labels stale, never a live zero", () => {
  for (const groups of [[], [sourceGroup]]) {
    const result = analyze([activity(1, 67, 1, { externalSourceGroupId: 20, plannedProgress: 82 })], groups);
    assert.equal(result.actualProgress, 67); assert.equal(result.plannedProgress, 82);
    assert.equal(result.dataStatus, "stale");
    assert.equal(result.activitiesAnalysis[0].sourceStatus, "stale");
    assert.equal(result.activitiesAnalysis[0].sourceLabel, null);
    assert.deepEqual(result.activitiesAnalysis[0].sourceDetails, []);
  }
});
test("cycles terminate and stale propagates; unavailable nested sources preserve snapshots", () => {
  const result = analyze([
    activity(1, 65, 1, { externalSourceGroupId: 20 }),
    activity(2, 45, 1, { projectId: 2, groupId: 20, externalSourceGroupId: 30 }),
    activity(3, 25, 1, { projectId: 3, groupId: 30, externalSourceGroupId: 20 }),
  ], [sourceGroup, { id: 30, projectId: 3, name: "cycle" }], [project(), project(2), project(3)]);
  assert.equal(result.dataStatus, "stale"); assert.equal(result.actualProgress, 25);
  assert(result.activitiesAnalysis[0].sourceDetails.length);
  const missing = analyze(mixed().map(a => a.id === 4 ? { ...a, externalSourceGroupId: 999 } : a),
    [sourceGroup], [project(), project(2)]);
  assert.equal(missing.dataStatus, "stale"); assert.equal(missing.actualProgress, 22.5);
});
test("read access is independent at each nested project and no source name escapes", () => {
  const restricted = analyze(mixed(), [sourceGroup], [project(), project(2)], [1]);
  const linked = restricted.activitiesAnalysis[1];
  assert.equal(linked.sourceStatus, "restricted"); assert.equal(linked.sourceLabel, null);
  assert.deepEqual(linked.sourceDetails, []); assert.equal(linked.sourceKey, "restricted-2");
  assert(!JSON.stringify(restricted).includes("Project 2"));
  close(restricted.actualProgress, 22.5);
});
test("portfolio-only projects never aggregate; invalid weights follow existing default without mutation", () => {
  const rows = [activity(1, 20, -1), activity(2, 0, NaN), activity(3, 100, 99, { projectId: 2 })];
  const before = rows[0].weight;
  const result = analyze(rows, [], [project(), project(2, { parentProjectId: 1 })]);
  assert.equal(result.actualProgress, 10); assert.equal(rows[0].weight, before);
});
test("no schedule/missing/reversed/activity dates retain actual but never imply healthy time", () => {
  for (const p of [project(1, { noSchedule: true }), project(1, { startDate: null }),
    project(1, { expectedEndDate: "2025-01-01" })]) {
    const result = analyze([activity(1, 40)], [], [p]);
    assert.equal(result.actualProgress, 40); assert.equal(result.plannedProgress, null);
    assert.equal(result.progressDeviation, null);
    assert.equal(analyzeTime(p, null, 40, date).timeDeviation, null);
  }
  const result = analyze([activity(1, 40, 1, { plannedEndDate: null })]);
  assert.equal(result.scheduleStatus, "incomplete"); assert.equal(result.plannedProgress, null);
  assert.equal(deviationStatus(null), "unavailable");
});
test("one-day item and pre-start use day boundaries and no spurious forecast", () => {
  const row = activity(1, 0, 1, { plannedStartDate: "2026-01-06", plannedEndDate: "2026-01-06" });
  assert.equal(analyze([row]).plannedProgress, 100);
  const future = analyze([{ ...row, plannedStartDate: "2026-01-07", plannedEndDate: "2026-01-07" }]);
  assert.equal(future.plannedProgress, 0); assert.equal(analyzeTime(project(), 0, 0, date).spi, null);
});
test("status thresholds use unrounded values", () => {
  assert.equal(deviationStatus(5), "on_track"); assert.equal(deviationStatus(5.00001), "ahead");
  assert.equal(deviationStatus(-5), "on_track"); assert.equal(deviationStatus(-5.00001), "slightly_delayed");
  assert.equal(deviationStatus(-15.00001), "significantly_delayed");
});
test("suspensions: union inclusive bounds, shifted overlap priority, future/contractor excluded from exemptions", () => {
  const rows = [
    { type: "official_holiday", startDate: "2026-01-01", endDate: "2026-01-05", datesShifted: true },
    { type: "force_majeure", startDate: "2026-01-04", endDate: "2026-01-08" },
    { type: "contractor_delay", startDate: "2026-01-02", endDate: "2026-01-09" },
    { type: "force_majeure", startDate: "2027-01-01", endDate: "2027-01-03" },
    { type: "official_holiday", startDate: "2025-12-20", endDate: "2025-12-30" },
  ];
  const metrics = analyzeSuspensions(rows, "2026-01-01", "2026-02-01", new Date("2026-01-08"));
  assert.equal(metrics.suspensionDays, 8); assert.equal(metrics.shiftedSuspensionDays, 5);
  assert.equal(metrics.unshiftedSuspensionDays, 3); assert.equal(metrics.contractorSuspensionDays, 7);
  const clipped = analyzeSuspensions(rows, "2026-01-03", "2026-01-05", date);
  assert.equal(clipped.suspensionDays, 3); assert.equal(clipped.shiftedSuspensionDays, 3);
  assert.equal(analyzeTime(project(), 50, 20, date).netDelayDays, null);
});
test("forecast reference is remaining work at elapsed average pace, never yesterday or invented actual end", () => {
  const t = analyzeTime(project(), 50, 20, date);
  assert.equal(t.forecastCompletionDate, "2026-01-26"); assert.equal(t.forecastDelayDays, 15);
  assert.equal(t.timeDeviation, -3); assert.equal(t.overrunDays, 0);
  for (const [planned, actual] of [[50, 0], [0, 20], [100, 100]]) {
    assert.equal(analyzeTime(project(), planned, actual, date).forecastCompletionDate, null);
  }
  assert.equal(analyzeTime(project(), 50, 100, date).forecastStatus, "completed_without_date");
  assert.equal(analyzeTime(project(), 50, 20, date, true).forecastCompletionDate, null);
  const overdue = analyzeTime(project(), 100, 99, new Date("2026-12-31"));
  assert(overdue.forecastCompletionDate > "2026-12-31");
  assert.equal(overdue.expectedProgressAtEnd, null);
});
test("large fractional-weight catalogue reconciles before rounding; 5000 target rows", () => {
  const rows = Array.from({ length: 5000 }, (_, i) => activity(i + 1, i % 101, (i % 7 + 1) / 3));
  const result = analyze(rows);
  close(result.activitiesAnalysis.reduce((s, a) => s + a.weightedImpact, 0), result.progressDeviation);
  close(result.activitiesAnalysis.reduce((s, a) => s + a.effectiveWeight, 0), 100);
});

const live = { date: "2026-01-06", plannedProgress: 50, actualProgress: 20, deviation: -30,
  kind: "live", reportId: null, baselineStatus: "available" };
const report = (id, day, snapshot, extra = {}) => ({
  id, reportDate: day, periodEnd: day, activitiesSnapshot: snapshot, createdAt: `${day}T12:00:00Z`,
  progressPercentage: 55, ...extra,
});
const snap = [{ actualProgress: 20, plannedProgress: 40, weight: 3, plannedHistoricalUnverified: false, actualAsOfDate: "2026-01-04" },
  { actualProgress: 0, plannedProgress: 40, weight: 1, plannedHistoricalUnverified: false, actualAsOfDate: "2026-01-04" }];
test("history uses stored values/weights; same-day reports and current live retained without synthetic start", () => {
  const reports = [report(3, "2026-01-06", snap), report(2, "2026-01-04", snap), report(1, "2026-01-04", snap)];
  const before = structuredClone(reports);
  const points = buildDeviationHistory(reports, live);
  assert.equal(points.length, 4); assert.deepEqual(points.map(p => p.reportId), [1, 2, 3, null]);
  assert.equal(points[0].plannedProgress, 40); assert.equal(points[0].actualProgress, 15);
  assert.equal(points[0].deviation, -25);
  assert.equal(points.at(-1).actualProgress, 20); assert.deepEqual(reports, before);
});
test("missing/empty/legacy/future history remains unknown; explicit report aggregate remains separate", () => {
  const points = buildDeviationHistory([
    report(1, "2026-01-01", []), report(2, "2026-01-02", null),
    report(3, "2026-01-03", [{ actualProgress: 90, plannedProgress: 50, weight: 1 }], { createdAt: "2026-02-01" }),
    report(4, "2026-01-04", [{ ...snap[0], actualHistoricalUnverified: true, plannedHistoricalUnverified: true }]),
    report(5, "2026-01-05", null, { progressSource: "manual", progressAsOfDate: "2026-01-05" }),
    report(6, "2026-02-01", snap),
  ], live);
  assert.equal(points.length, 6);
  for (const p of points.slice(0, 4)) {
    assert.equal(p.actualProgress, null); assert.equal(p.plannedProgress, null); assert.equal(p.deviation, null);
  }
  assert.equal(points[4].actualProgress, 55); assert.equal(points[4].plannedProgress, null);
  assert.equal(buildDeviationHistory([report(1, "2026-01-01", snap)], live, false).length, 1);
});
test("explicit period mismatch never falls back to creation timestamp; linked unknown baseline stays unknown", () => {
  const points = buildDeviationHistory([
    report(1, "2026-01-05", snap),
    report(2, "2026-01-04", [{ ...snap[0], plannedAsOfDate: "2026-01-03", externalSourceGroupId: 2 }]),
  ], live);
  assert.equal(points[0].plannedProgress, null);
  assert.equal(points[0].actualProgress, 20);
  assert.equal(points[1].actualProgress, null);
  assert.equal(points[1].plannedProgress, 40);
});
