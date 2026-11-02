import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = readFileSync(new URL("../../construction-supervision/src/pages/projects/[id]/activities.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("activities.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "visibleGroups") {
    expressions.push(node.initializer.getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
const groups = [{ id: 1, name: "Selected" }, { id: 2, name: "Other" }, { id: 3, name: "Empty" }];
function visible(index, groupFilter, groupMap = new Map([[1, [{}]], [2, [{}]], [3, []]]), statusFilter = "all", categoryGroupIds = new Set([1, 2, 3])) {
  return vm.runInNewContext(expressions[index], { sortedGroups: groups, groupFilter, groupMap, statusFilter, categoryGroupIds }).map(group => group.id);
}
test("principal filter hides all other group headers on desktop and mobile", () => {
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(Array.from(visible(index, "all", new Map([[1, [{}]], [2, [{}]]]), "all", new Set([2]))), [2]);
    assert.deepEqual(Array.from(visible(index, 1, new Map([[1, [{}]], [2, [{}]]]), "all", new Set([2]))), []);
  }
});
test("desktop and mobile apply the same selected group restriction, not just row filtering", () => {
  assert.equal(expressions.length, 2);
  for (let index = 0; index < 2; index++) {
    assert.deepEqual(Array.from(visible(index, 1)), [1]);
    assert.deepEqual(Array.from(visible(index, 2)), [2]);
    assert.deepEqual(Array.from(visible(index, "ungrouped")), []);
  }
});
test("all groups restores the original desktop/mobile empty-group behavior", () => {
  assert.deepEqual(Array.from(visible(0, "all")), [1, 2, 3]);
  assert.deepEqual(Array.from(visible(1, "all")), [1, 2]);
});
test("selecting an empty group or filtering its rows away never reveals other groups", () => {
  assert.deepEqual(Array.from(visible(0, 3)), [3]);
  assert.deepEqual(Array.from(visible(1, 3)), []);
  for (let index = 0; index < 2; index++) {
    assert.ok(!visible(index, 1, new Map([[1, []], [2, []], [3, []]])).includes(2));
  }
});
test("active filter has an accessible label, solid selection color and a group-only reset", () => {
  assert.match(code, /role="status"[^>]*bg-primary/);
  assert.match(code, /فلتر المجموعات مفعّل:/);
  assert.match(code, /onClick=\{\(\) => setGroupFilter\("all"\)\}>\s*إلغاء فلتر المجموعة/);
  assert.match(code, /isSelected \? "border-primary bg-primary text-primary-foreground"/);
});

test("status filters hide nonmatching group headings on desktop and mobile", () => {
  for (const status of ["completed", "in_progress", "not_started", "delayed"]) {
    for (let index = 0; index < 2; index++) {
      assert.deepEqual(Array.from(visible(index, "all", new Map([[1, []], [2, [{}]], [3, []]]), status)), [2]);
      assert.deepEqual(Array.from(visible(index, "all", new Map(), status)), []);
      assert.deepEqual(Array.from(visible(index, 1, new Map([[1, []], [2, [{}]]]), status)), []);
    }
  }
});

test("status filter has a solid indicator and its own reset, without removing group selection", () => {
  assert.match(code, /aria-label="فلتر الحالة المفعّل"/);
  assert.match(code, /فلتر الحالة مفعّل:/);
  assert.match(code, /onClick=\{\(\) => setStatusFilter\("all"\)\}>\s*إلغاء فلتر الحالة/);
  assert.match(code, /isSelected \? "bg-primary text-primary-foreground hover:bg-primary"/);
});
