import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { PgDialect, pgTable, integer } from "drizzle-orm/pg-core";
import * as XLSX from "xlsx";

async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const client = await load("../../construction-supervision/src/lib/activity-order.ts");
const excel = await load("../src/lib/excel-activity-import.ts");
const server = await load("../src/lib/activity-order.ts");
const rows = [
  { id: 1, groupId: 10, sortOrder: 0, actualProgress: 42 },
  { id: 2, groupId: 20, sortOrder: 1 },
  { id: 3, groupId: 10, sortOrder: 2 },
  { id: 4, groupId: 10, sortOrder: 3, managedByGroupId: 10 },
];

test("drag reorders only the group's visible slots, preserving hidden/other-group rows and data", () => {
  const items = client.planActivityReorder(rows, [1, 4], 4, 1);
  const updated = client.applyActivityOrder(rows, items);
  assert.deepEqual(updated.map(row => row.id), [4, 2, 3, 1]);
  assert.equal(updated.find(row => row.id === 1).actualProgress, 42);
  assert.equal(updated.find(row => row.id === 4).managedByGroupId, 10);
  assert.ok(items.every(item => !("groupId" in item)));
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4]);
});
test("cross-group, missing and self drops are no-ops, not silent group transfers", () => {
  for (const [active, over] of [[1, 2], [99, 1], [1, 1]]) {
    assert.deepEqual(client.planActivityReorder(rows, [1, 2, 3, 4], active, over), []);
  }
});
test("managed and ordinary rows use the same global unique order; persisted reload is stable", () => {
  const tied = rows.map(row => ({ ...row, sortOrder: 0 }));
  const items = client.planActivityReorder(tied, [1, 2, 3, 4], 4, 1);
  const updated = client.applyActivityOrder(tied, items);
  assert.deepEqual(updated.map(row => row.id), [4, 2, 1, 3]);
  assert.equal(new Set(updated.map(row => row.sortOrder)).size, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(updated)).sort(client.compareActivityOrder), updated);
});
test("ungrouped rows can reorder without adopting a group", () => {
  const rows = [{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 1, groupId: null }];
  assert.deepEqual(client.applyActivityOrder(rows, client.planActivityReorder(rows, [1, 2], 2, 1)).map(row => row.id), [2, 1]);
});
test("server rejects malformed, duplicate, negative or overflowing sort requests", () => {
  for (const value of [null, [], [null], [{ id: 1 }], [{ id: 1, sortOrder: -1 }],
    [{ id: 1, sortOrder: 1.5 }], [{ id: 1, sortOrder: 2147483648 }],
    [{ id: 1, sortOrder: 0 }, { id: 1, sortOrder: 1 }],
    [{ id: 1, sortOrder: 0, groupId: "2" }]]) assert.equal(server.validActivityOrderItems(value), false);
  assert.equal(server.validActivityOrderItems([{ id: 1, sortOrder: 0 }]), true);
});
test("pure reorder writes one parameterized CASE update instead of one round trip per row", () => {
  const table = pgTable("activities", { id: integer("id") });
  const query = new PgDialect().sqlToQuery(server.activityOrderCase(table.id, [{ id: 12, sortOrder: 3 }, { id: 7, sortOrder: 4 }]));
  assert.deepEqual(query.params, [12, 3, 7, 4]);
  assert.match(query.sql, /CASE WHEN .* THEN \$2::integer WHEN .* THEN \$4::integer END/);
});
test("actual route permits changed-row subsets but rejects IDs outside this project", () => {
  const code = readFileSync(new URL("../src/routes/activities.ts", import.meta.url), "utf8");
  const condition = code.match(/if \((items\.some[^\n]+)\) \{\s*return \{ invalidItems/)[1];
  const currentById = new Map([[1, {}], [2, {}], [3, {}]]);
  assert.equal(vm.runInNewContext(condition, { currentById, items: [{ id: 2, sortOrder: 0 }] }), false);
  assert.equal(vm.runInNewContext(condition, { currentById, items: [{ id: 99, sortOrder: 0 }] }), true);
});
test("real Excel read and parser retain file row order, not names or schedule dates", () => {
  const original = [
    ["اسم البند", "البداية", "النهاية"],
    ["المجموعة ب"], ["آخر أبجدياً", "2026-12-01", "2026-12-10"],
    ["أول أبجدياً", "2026-01-01", "2026-01-10"],
    ["المجموعة أ"], ["بند أخير", "2026-02-01", "2026-02-10"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(original), "جدول");
  const read = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellDates: true });
  const data = XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], { header: 1, raw: false, dateNF: "yyyy-mm-dd" });
  const plan = excel.planExcelActivityImport(data, "detect", [{ id: 1, name: "المجموعة أ" }, { id: 2, name: "المجموعة ب" }]);
  assert.deepEqual(plan.rows.filter(row => row.kind === "activity").map(row => row.name), ["آخر أبجدياً", "أول أبجدياً", "بند أخير"]);
  const changes = excel.planImportedGroupOrder([{ id: 1, sortOrder: 0 }, { id: 2, sortOrder: 1 }], plan.groups.map(group => group.matches[0].id));
  assert.deepEqual(changes, [{ id: 2, sortOrder: 0 }, { id: 1, sortOrder: 1 }]);
});
test("mixed new/reused imported groups follow first occurrence without displacing unrelated group slots", () => {
  const current = [{ id: 1, sortOrder: 0 }, { id: 9, sortOrder: 1 }, { id: 3, sortOrder: 2 }];
  const changes = excel.planImportedGroupOrder(current, [3, 1, 3]);
  assert.deepEqual(changes, [{ id: 3, sortOrder: 0 }, { id: 1, sortOrder: 2 }]);
  assert.equal(changes.some(group => group.id === 9), false);
  assert.deepEqual(excel.planImportedGroupOrder(current, []), []);
  assert.deepEqual(excel.planImportedGroupOrder(current, [1]), []);
});
test("sortable item sequence matches actual interleaved DOM and excludes collapsed rows", () => {
  const code = readFileSync(new URL("../../construction-supervision/src/pages/projects/[id]/activities.tsx", import.meta.url), "utf8");
  const expression = code.match(/const sortableRowIds = ([\s\S]*?);\n\s*if \(!collapsedGroups/)[1].replace(/flatMap<string \| number>/, "flatMap");
  const actual = vm.runInNewContext(expression, {
    visibleGroups: [{ id: 10 }, { id: 20 }], collapsedGroups: new Set([20]),
    groupMap: new Map([[10, [{ id: 1 }, { id: 3 }]], [20, [{ id: 2 }]]]),
  });
  assert.deepEqual(Array.from(actual), ["group-10", 1, 3, "group-20"]);
  assert.match(code, /onMutate: async items/);
  assert.match(code, /context\?\.previous/);
  assert.match(code, /aria-label="سحب لتغيير الترتيب"/);
});
