import assert from "node:assert/strict";
import test from "node:test";
import { buildProjectAiSummaryContext } from "../src/lib/project-ai-summary-context.ts";
import { calcSPI, roundPercent } from "../src/lib/progress.ts";

const metrics = { calcSPI, roundPercent };

test("AI summary context retains every group, status, and linked resolved activity", () => {
  const groups = [
    { id: 1, name: "الأعمال المدنية" },
    { id: 2, name: "الكهرباء" },
    { id: 3, name: "مجموعة بلا أنشطة" },
  ];
  const activities = [
    {
      id: 11, name: "نشاط يدوي", groupId: 1, status: "in_progress",
      actualProgress: 40, plannedProgress: 50, weight: 2, variance: -10,
      plannedStartDate: "2025-01-01", plannedEndDate: "2025-02-01",
      actualEndDate: null, delayed: true, linkedToSource: false, generatedByGroup: false,
    },
    {
      id: 12, name: "نشاط مرتبط", groupId: 1, status: "completed",
      // These are the resolved source-group values provided to the builder.
      actualProgress: 80, plannedProgress: 60, weight: 1, variance: 20,
      plannedStartDate: "2025-01-01", plannedEndDate: "2025-02-01",
      actualEndDate: "2025-02-03", delayed: true, linkedToSource: true, generatedByGroup: false,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: 20 + index,
      name: `نشاط استثناء ${index + 1}`,
      groupId: 2,
      status: index === 0 ? "delayed" : index === 1 ? "not_started" : "in_progress",
      actualProgress: index,
      plannedProgress: 50,
      weight: 1,
      variance: index - 50,
      plannedStartDate: null,
      plannedEndDate: null,
      actualEndDate: null,
      delayed: true,
      linkedToSource: index === 7,
      generatedByGroup: index === 6,
    })),
    {
      id: 99, name: "نشاط بلا مجموعة", groupId: null, status: "custom_status",
      actualProgress: 10, plannedProgress: 0, weight: 1, variance: 10,
      plannedStartDate: null, plannedEndDate: null, actualEndDate: null,
      delayed: false, linkedToSource: false, generatedByGroup: false,
    },
  ];

  const context = buildProjectAiSummaryContext(groups, activities, metrics);
  assert.equal(context.activityCount, activities.length);
  assert.equal(context.groups.length, 3);
  assert.equal(context.groups[0].name, "الأعمال المدنية");
  assert.equal(context.groups[0].planned, 55);
  assert.equal(context.groups[0].actual, 60);
  assert.equal(context.groups[0].spi, 1.09);
  assert.equal(context.groups[0].activities.find(item => item.id === 12).actualProgress, 80);
  assert.equal(context.groups[0].activities.find(item => item.id === 12).linkedToSource, true);
  assert.equal(context.groups[1].activities.length, 8);
  assert.equal(context.groups[1].statusCounts.delayed, 1);
  assert.equal(context.groups[1].statusCounts.not_started, 1);
  assert.equal(context.groups[1].statusCounts.in_progress, 6);
  assert.equal(context.groups[1].activities.length, 8, "no top-five truncation");
  assert.equal(context.groups[2].activityCount, 0, "empty groups remain represented");
  assert.equal(context.groups[2].statusCounts.completed, 0);
  assert.equal(context.ungrouped.activities[0].status, "custom_status");
  assert.equal(context.statusCounts.custom_status, 1);
  assert.equal(context.delayedActivityCount, 10);
});

test("large projects compress stable details but preserve metrics and all exceptions", () => {
  const groups = [
    { id: 1, name: "المجموعة الأولى" },
    { id: 2, name: "المجموعة الثانية" },
  ];
  const stable = (id, groupId, status) => ({
    id, name: `نشاط مستقر ${id}`, groupId, status,
    actualProgress: 50, plannedProgress: 50, weight: 1, variance: 0,
    plannedStartDate: null, plannedEndDate: null, actualEndDate: null,
    delayed: false, linkedToSource: false, generatedByGroup: false,
  });
  const activities = [
    ...Array.from({ length: 55 }, (_, index) => stable(index + 1, 1, "in_progress")),
    {
      ...stable(1001, 1, "completed"),
      actualProgress: 50, delayed: true,
    },
    {
      ...stable(1002, 1, "in_progress"),
      actualProgress: 42, variance: -8,
    },
    ...Array.from({ length: 10 }, (_, index) => stable(index + 200, 2, "not_started")),
  ];
  const context = buildProjectAiSummaryContext(groups, activities, metrics);

  assert.equal(context.detailsCompressed, true);
  assert.equal(context.stableDetailThreshold, 40);
  assert.equal(context.activityCount, 67);
  assert.equal(context.omittedStableActivityCount, 61);

  const first = context.groups[0];
  assert.equal(first.activityCount, 57);
  assert.equal(first.statusCounts.in_progress, 56);
  assert.equal(first.statusCounts.completed, 1);
  assert.equal(first.omittedStableActivityCount, 53);
  assert.equal(first.omittedStableActivityCounts.in_progress, 53);
  assert.deepEqual(
    first.activities.filter(activity => activity.delayed || Math.abs(activity.variance) >= 5).map(activity => activity.id),
    [1001, 1002],
  );
  assert.equal(first.activities.filter(activity => activity.status === "in_progress").length, 3);

  const second = context.groups[1];
  assert.equal(second.statusCounts.not_started, 10);
  assert.equal(second.activities.length, 2, "retain stable representatives for this group/status");
  assert.equal(second.omittedStableActivityCounts.not_started, 8);
  assert.equal(second.planned, 50);
  assert.equal(second.actual, 50);
  assert.equal(second.spi, 1);
});