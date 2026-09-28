import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveActivityWeight,
  weightedActivityProgress,
  calcPlannedProgressForProject,
  calcActualProgressForProject,
  calcSPI,
} from "../src/lib/progress.ts";
import { summarizeSourceChildren } from "../src/lib/activity-source-rules.ts";
import { buildProjectAiSummaryContext } from "../src/lib/project-ai-summary-context.ts";

const date = (day) => new Date(`${day}T00:00:00Z`);
const item = (start, end, actualProgress, weight = 1, plannedProgress = 0) => ({
  plannedStartDate: start, plannedEndDate: end, actualProgress, weight, plannedProgress,
});

test("duration weight includes both endpoints, overlaps remain independent and stored custom weight is untouched", () => {
  const long = item("2026-01-01", "2026-01-10", 20, 100);
  const short = item("2026-01-06", "2026-01-06", 100, 1);
  assert.equal(effectiveActivityWeight(long), 10);
  assert.equal(effectiveActivityWeight(short), 1);
  assert.equal(calcActualProgressForProject([long, short]), 300 / 11);
  const planned = calcPlannedProgressForProject([long, short], 5, 10, date("2026-01-06"));
  assert.equal(planned, (10 * (5 / 9 * 100) + 100) / 11);
  assert.equal(calcSPI(planned, calcActualProgressForProject([long, short])), 0.46);
  assert.equal(long.weight, 100, "duration must not mutate persisted custom weight");
  assert.equal(effectiveActivityWeight(long, "custom"), 100);
  assert.equal(effectiveActivityWeight(long, "equal"), 1);
  assert.equal(calcActualProgressForProject([long, short], "custom"), 2100 / 101);
});

test("missing, inverted and malformed dates fall back to one; leap day and UTC instants are calendar-safe", () => {
  for (const [start, end] of [
    [null, "2026-01-01"], ["2026-01-01", null],
    ["invalid", "2026-01-05"], ["2026-02-30", "2026-03-03"],
    ["2026-03-03", "2026-02-28"],
  ]) assert.equal(effectiveActivityWeight(item(start, end, 50)), 1);
  assert.equal(effectiveActivityWeight(item("2024-02-28", "2024-03-01", 50)), 3);
  assert.equal(effectiveActivityWeight(item("2026-01-01T23:59:00Z", "2026-01-02T00:01:00Z", 50)), 2);
  const rows = [item(null, null, 20), item("2026-01-01", "2026-01-01", 80)];
  assert.equal(calcActualProgressForProject(rows), 50);
  assert.equal(weightedActivityProgress(rows, row => row.plannedProgress), 0);
  assert.equal(calcActualProgressForProject([]), 0);
});

test("Excel rows and linked/generated targets use their own dates; source group uses its children's durations", () => {
  const sourceChildren = [
    item("2026-01-01", "2026-01-09", 20, 1, 30),
    item("2026-01-05", "2026-01-05", 100, 99, 90),
  ];
  const source = summarizeSourceChildren(sourceChildren, {
    groupId: 3, projectId: 2, projectName: "Source", groupName: "Group", linkCode: "ABC",
  });
  assert.equal(source.actualProgress, 28);
  assert.equal(source.plannedProgress, 36);
  const importedExcel = item("2026-01-01", "2026-01-03", 60, 50, 75);
  const generatedTarget = {
    ...item(source.plannedStartDate, source.plannedEndDate, source.actualProgress, 1, source.plannedProgress),
    externalSourceGroupId: source.groupId, managedByGroupId: 4,
  };
  assert.equal(effectiveActivityWeight(generatedTarget), 9);
  assert.equal(calcActualProgressForProject([importedExcel, generatedTarget]), (3 * 60 + 9 * 28) / 12);
  assert.equal(weightedActivityProgress([importedExcel, generatedTarget], a => a.plannedProgress), (3 * 75 + 9 * 36) / 12);
});

test("executive group progress shares live duration weights; saved old snapshots keep their stored weights", () => {
  const rows = [
    item("2026-01-01", "2026-01-09", 20, 1, 30),
    item("2026-01-09", "2026-01-09", 100, 9, 90),
  ];
  const activities = rows.map((row, i) => ({
    ...row, id: i + 1, name: `Activity ${i + 1}`, groupId: 1,
    status: "in_progress", variance: row.actualProgress - row.plannedProgress,
    actualEndDate: null, delayed: false, linkedToSource: false, generatedByGroup: false,
  }));
  const context = buildProjectAiSummaryContext([{ id: 1, name: "Group" }], activities, {
    roundPercent: x => Math.round(x * 10) / 10,
    calcSPI,
  });
  assert.equal(context.groups[0].actual, 28);
  assert.equal(context.groups[0].planned, 36);
  assert.equal(context.groups[0].spi, 0.78);
  // Historical report rows have a frozen weight value; do not reinterpret dates.
  assert.equal(calcActualProgressForProject(rows, "custom"), 92);
  assert.equal(weightedActivityProgress(rows, a => a.plannedProgress, "custom"), 84);
});