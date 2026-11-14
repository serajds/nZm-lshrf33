import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnerActivitySections, buildOwnerGroupProgressData } from "../artifacts/construction-supervision/src/lib/owner-activity-groups.ts";

const activity = (id, groupId, sortOrder, plannedProgress, actualProgress, weight = 1) => ({
  id,
  groupId,
  sortOrder,
  plannedProgress,
  actualProgress,
  weight,
});

test("owner sections follow group order and preserve activity order", () => {
  const groups = [
    { id: 20, name: "الأعمال الكهربائية", color: "#ef4444", sortOrder: 2 },
    { id: 10, name: "الأعمال المدنية", color: "#3b82f6", sortOrder: 1 },
  ];
  const activities = [
    activity(1, 20, 0, 10, 15),
    activity(2, 10, 1, 20, 25),
    activity(3, 20, 2, 30, 35),
    activity(4, null, 3, 40, 45),
    activity(5, 999, 4, 50, 55),
  ];

  const sections = buildOwnerActivitySections(groups, activities);
  assert.deepEqual(sections.map(({ name }) => name), [
    "الأعمال المدنية",
    "الأعمال الكهربائية",
    "بدون مجموعة",
  ]);
  assert.deepEqual(sections.map(({ activities: rows }) => rows.map(({ id }) => id)), [
    [2],
    [1, 3],
    [4, 5],
  ]);
});

test("projects without groups show all activities as ungrouped", () => {
  const sections = buildOwnerActivitySections([], [
    activity(1, null, 0, 20, 10),
    activity(2, null, 1, 80, 70),
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].name, "بدون مجموعة");
  assert.equal(sections[0].activities.length, 2);
});

test("group chart values are weight-accurate and keep empty groups", () => {
  const sections = buildOwnerActivitySections(
    [
      { id: 1, name: "مجموعة طويلة", color: "#3b82f6", sortOrder: 0 },
      { id: 2, name: "مجموعة فارغة", color: "#10b981", sortOrder: 1 },
    ],
    [
      activity(1, 1, 0, 20, 10, 1),
      activity(2, 1, 1, 80, 70, 3),
    ],
  );

  assert.deepEqual(buildOwnerGroupProgressData(sections), [
    {
      id: "group-1",
      name: "مجموعة طويلة",
      color: "#3b82f6",
      activityCount: 2,
      planned: 65,
      actual: 55,
    },
    {
      id: "group-2",
      name: "مجموعة فارغة",
      color: "#10b981",
      activityCount: 0,
      planned: 0,
      actual: 0,
    },
  ]);
});
