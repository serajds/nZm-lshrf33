import assert from "node:assert/strict";
import test from "node:test";
import { buildReportAiContext, reportAiSnapshotFingerprint } from "../src/lib/report-ai-context.ts";
import { selectReportSnapshotActivities } from "../src/lib/report-snapshot-selection.ts";

test("new-report AI gets the same selected manual, Excel and linked rows as its snapshot", () => {
  const activities = [
    { id: 1, name: "يدوي", status: "in_progress", groupId: 1, actualProgress: 30, plannedProgress: 40 },
    { id: 2, name: "Excel", status: "completed", groupId: 2, actualProgress: 100, plannedProgress: 100 },
    { id: 3, name: "مولّد مرتبط", status: "in_progress", groupId: 2, actualProgress: 55, plannedProgress: 60, externalSourceGroupId: 44 },
    { id: 4, name: "لم يبدأ", status: "not_started", groupId: 1, actualProgress: 0, plannedProgress: 10 },
  ];
  const snapshot = selectReportSnapshotActivities(activities).map(activity => ({
    ...activity, plannedAsOfDate: "2026-01-10", actualRecordedAt: "2026-01-10T09:00:00Z",
  }));
  const context = buildReportAiContext(snapshot, "2026-01-10", new Map([
    [1, "مدني"], [2, "كهرباء"], [3, "كهرباء"],
  ]));
  assert.deepEqual(context.map(row => row.name), ["يدوي", "Excel", "مولّد مرتبط"]);
  assert.deepEqual(context.map(row => row.group), ["مدني", "كهرباء", "كهرباء"]);
  assert.equal(context[2].deviationPoints, -5);
});

test("historical report AI preserves saved linked progress after today's source changes", () => {
  const savedSnapshot = [{
    id: 3, name: "مرتبط", status: "in_progress",
    actualProgress: 35, plannedProgress: 50,
    plannedAsOfDate: "2025-02-01", actualRecordedAt: "2025-02-01T08:00:00Z",
    externalSourceGroupId: 44,
    plannedStartDate: "2025-01-01", plannedEndDate: "2025-03-01",
  }];
  const liveLinkedSourceNow = { actualProgress: 95, plannedProgress: 100 };
  const oldContext = buildReportAiContext(savedSnapshot, "2025-02-01", new Map([[3, "موقع أ"]]));
  assert.equal(oldContext[0].actualProgress, 35);
  assert.equal(oldContext[0].plannedProgressAtReportDate, 50);
  assert.equal(oldContext[0].deviationPoints, -15);
  assert.notEqual(oldContext[0].actualProgress, liveLinkedSourceNow.actualProgress);
  assert.equal(oldContext[0].positionAgainstPlan, "خلف المخطط");
  assert.notEqual(
    reportAiSnapshotFingerprint("2025-02-01", savedSnapshot),
    reportAiSnapshotFingerprint("2025-02-01", [{ ...savedSnapshot[0], ...liveLinkedSourceNow }]),
    "a new report must reject saving an AI draft if source progress changed",
  );
  assert.notEqual(
    reportAiSnapshotFingerprint("2025-02-01", savedSnapshot, "2025-01-01", "2025-02-01"),
    reportAiSnapshotFingerprint("2025-02-01", savedSnapshot, "2025-01-01", "2025-02-02"),
    "a new report must reject saving AI text drafted for a different period",
  );

  const liveProjectActivity = { ...savedSnapshot[0], ...liveLinkedSourceNow };
  assert.equal(liveProjectActivity.actualProgress, 95, "project context uses live resolved progress");
  assert.equal(buildReportAiContext(savedSnapshot, "2025-02-01", new Map([[3, "موقع أ"]]))[0].actualProgress, 35);
});

test("unverified old planned values are never treated as historical variance", () => {
  const context = buildReportAiContext([{
    id: 7, name: "بند قديم", status: "completed",
    actualProgress: 100, plannedProgress: 70,
    plannedHistoricalUnverified: true, plannedAsOfDate: "2026-03-01",
    actualRecordedAt: "2026-04-01T12:00:00Z",
  }], "2026-01-01", new Map());
  assert.equal(context[0].plannedProgressAtReportDate, null);
  assert.equal(context[0].deviationPoints, null);
  assert.equal(context[0].actualRecordedAfterReportDate, true);
  assert.equal(context[0].actualHistoricalUnverified, true);
});

test("backdated and legacy values remain visible but never imply proven historical progress", () => {
  const context = buildReportAiContext([
    { id: 5, name: "تاريخ سابق", status: "in_progress", plannedProgress: 70, actualProgress: 60, plannedAsOfDate: "2025-01-01", actualRecordedAt: "2025-02-01T08:00:00Z", plannedEndDate: "2024-12-31" },
    { id: 6, name: "لقطة قديمة", status: "completed", plannedProgress: 40, actualProgress: 90 },
  ], "2025-01-01", new Map());
  assert.equal(context[0].actualProgress, 60);
  assert.equal(context[0].deviationPoints, null);
  assert.equal(context[0].scheduleDelay, "غير مثبت");
  assert.equal(context[1].plannedProgressAtReportDate, null);
  assert.equal(context[1].deviationPoints, null);
});