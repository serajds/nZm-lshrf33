import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(path) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
}
const { buildReportActivityAnalysis } = await load("../src/lib/report-activity-analysis.ts");
const { approvedReportFingerprint } = await load("../src/lib/report-approved-inputs.ts");
const day = "2026-09-30";
const row = { id: 1, name: "بند", actualProgress: 40, plannedProgress: 70,
  actualAsOfDate: day, plannedAsOfDate: day };

test("classifies all verified activities and measures schedule gaps without inferring execution dates", () => {
  const analysis = buildReportActivityAnalysis([
    row, { ...row, id: 2, actualProgress: 100 },
    { ...row, id: 3, actualProgress: 0 },
  ], day);
  assert.equal(analysis.completedCount, 1);
  assert.equal(analysis.inProgressCount, 1);
  assert.equal(analysis.notStartedCount, 1);
  assert.equal(analysis.belowPlanCount, 2);
  assert.equal(analysis.activities[0].variancePoints, -30);
  assert.equal(analysis.scope, "cumulative_state_not_work_executed_during_period");
});
test("wrong-date, unverified and invalid percentages are excluded, never replaced with zero", () => {
  for (const patch of [
    { actualAsOfDate: "2026-10-25" }, { actualAsOfDate: undefined },
    { actualHistoricalUnverified: true }, { actualProgress: 101 }, { actualProgress: NaN },
  ]) {
    const analysis = buildReportActivityAnalysis([{ ...row, ...patch }], day);
    assert.equal(analysis.verifiedActualCount, 0);
    assert.equal(analysis.notStartedCount, 0);
    assert.equal(analysis.activities[0].actualProgressAsOfPeriodEnd, null);
    assert.equal(analysis.activities[0].variancePoints, null);
  }
});
test("unverified plan cannot produce a delay or leak a historical schedule claim", () => {
  const analysis = buildReportActivityAnalysis([{ ...row, plannedHistoricalUnverified: true,
    plannedStartDate: "2026-01-01", externalSourceGroupId: 4 }], day);
  assert.equal(analysis.activities[0].plannedStartDate, null);
  assert.equal(analysis.activities[0].variancePoints, null);
  assert.equal(analysis.activities[0].linkedSource, true);
});
test("draft fingerprint changes with activity data and historical provenance", () => {
  const fingerprint = rows => approvedReportFingerprint("2026-10-25", "2026-09-01", day, 35,
    buildReportActivityAnalysis(rows, day));
  assert.match(fingerprint([row]), /^approved-activities:/);
  for (const patch of [{ actualProgress: 50 }, { name: "اسم آخر" }, { plannedProgress: 90 }, { actualHistoricalUnverified: true }]) {
    assert.notEqual(fingerprint([row]), fingerprint([{ ...row, ...patch }]));
  }
});
