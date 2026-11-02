import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { normalizeCategoryName, parseCategoryAssignment } = await load("../src/lib/activity-group-categories.ts");
const { groupsForCategory, activityMatchesCategory } = await load("../../construction-supervision/src/lib/activity-category-filter.ts");
test("normalizes manually named principal groups and rejects empty/oversized/non-string names", () => {
  assert.equal(normalizeCategoryName("  أعمال   التشطيبات  "), "أعمال التشطيبات");
  for (const name of [null, 3, {}, "", "  ", "أ".repeat(121)]) assert.equal(normalizeCategoryName(name), null);
});
test("bulk classification supports create, reuse and release without assigning individual activities", () => {
  assert.deepEqual(parseCategoryAssignment({ groupIds: [2, 3], categoryId: 5 }), { groupIds: [2, 3], categoryId: 5 });
  assert.deepEqual(parseCategoryAssignment({ groupIds: [2], categoryId: null }), { groupIds: [2], categoryId: null });
  assert.deepEqual(parseCategoryAssignment({ groupIds: [2, 3], categoryId: null, newCategoryName: "  أعمال  مدنية " }),
    { groupIds: [2, 3], categoryId: null, newCategoryName: "أعمال مدنية" });
});
test("missing targets, duplicate/invalid IDs and ambiguous new+existing targets are rejected", () => {
  for (const body of [null, {}, { groupIds: [], categoryId: null }, { groupIds: [1, 1], categoryId: null },
    { groupIds: [1] }, { groupIds: ["1"], categoryId: 2 }, { groupIds: [0], categoryId: null },
    { groupIds: [1], categoryId: "2" }, { groupIds: [1], categoryId: null, newCategoryName: "" },
    { groupIds: [1], categoryId: 2, newCategoryName: "new" }]) assert.equal(parseCategoryAssignment(body), null);
});
test("two-level filters preserve existing groups, data and order and handle unclassified/ungrouped activities", () => {
  const groups = [{ id: 1, categoryId: 8, name: "A" }, { id: 2, name: "B" }, { id: 3, categoryId: 8, name: "C" }, { id: 4, categoryId: 9 }];
  const original = JSON.stringify(groups);
  assert.deepEqual(groupsForCategory(groups, 8).map(group => group.id), [1, 3]);
  assert.deepEqual(groupsForCategory(groups, "uncategorized").map(group => group.id), [2]);
  assert.deepEqual(groupsForCategory(groups, "all"), groups);
  const ids = new Set(groupsForCategory(groups, 8).map(group => group.id));
  assert.equal(activityMatchesCategory(1, 8, ids), true);
  assert.equal(activityMatchesCategory(2, 8, ids), false);
  assert.equal(activityMatchesCategory(null, 8, ids), false);
  assert.equal(activityMatchesCategory(null, "uncategorized", new Set([2])), true);
  assert.equal(activityMatchesCategory(2, "uncategorized", new Set([2])), true);
  assert.equal(activityMatchesCategory(null, "all", new Set()), true);
  assert.equal(JSON.stringify(groups), original);
});
