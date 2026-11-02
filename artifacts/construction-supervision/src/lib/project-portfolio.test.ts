// Run: node --experimental-strip-types --test src/lib/project-portfolio.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioView, portfolioCounters, parentCandidates, EMPTY_FILTERS, apiErrorMessage } from "./project-portfolio.ts";

const P = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, status: "active", ownerEntity: "بلدية مصراتة", ...extra });
const list = [
  P(1, "مجمع المدارس", { portfolioRelation: "main" }),
  P(2, "مدرسة الزهراء", { parentProjectId: 1, portfolioRelation: "child", status: "delayed" }),
  P(3, "مدرسة النور", { parentProjectId: 1, portfolioRelation: "child" }),
  P(4, "طريق الساحل", { portfolioRelation: "independent", categoryId: 7 }),
  P(5, "مبنى مخفي الأب", { parentProjectId: null, portfolioRelation: "child" }),
];

test("unfiltered shows groups, standalone, other children", () => {
  const v = buildPortfolioView(list, EMPTY_FILTERS);
  assert.equal(v.groups.length, 1);
  assert.equal(v.groups[0].children.length, 2);
  assert.deepEqual(v.standalone.map(p => p.id), [4]);
  assert.deepEqual(v.otherChildren.map(p => p.id), [5]);
  assert.equal(v.matchedCount, 5);
});

test("matching child brings parent as context", () => {
  const v = buildPortfolioView(list, { ...EMPTY_FILTERS, status: "delayed" });
  assert.equal(v.groups.length, 1);
  assert.equal(v.groups[0].parentMatches, false);
  assert.deepEqual(v.groups[0].children.map(p => p.id), [2]);
  assert.equal(v.matchedCount, 1);
});

test("counters are stable and global", () => {
  const c = portfolioCounters(list);
  assert.equal(c.total, 5);
  assert.equal(c.main, 1);
  assert.equal(c.child, 3);
  assert.equal(c.independent, 1);
});

test("category and search filters", () => {
  assert.equal(buildPortfolioView(list, { ...EMPTY_FILTERS, category: "7" }).matchedCount, 1);
  assert.equal(buildPortfolioView(list, { ...EMPTY_FILTERS, category: "none" }).matchedCount, 4);
  assert.equal(buildPortfolioView(list, { ...EMPTY_FILTERS, search: "مدرسه" }).matchedCount, 2);
});

test("parent candidates exclude self, children and hidden-parent children", () => {
  assert.deepEqual(parentCandidates(list, 4).map(p => p.id), [1]);
  assert.deepEqual(parentCandidates(list, 1).map(p => p.id), [4]);
});

test("api error message", () => {
  assert.equal(apiErrorMessage({ data: { error: "الاسم مستخدم" } }, "x"), "الاسم مستخدم");
  assert.equal(apiErrorMessage(null, "x"), "x");
});

import { formValuesToPayload } from "./project-portfolio.ts";
const base = { name: "x", noSchedule: true, startDate: "", expectedEndDate: "", parentProjectId: "1", categoryId: "none" };

test("non-admin payload omits parentProjectId entirely", () => {
  const p = formValuesToPayload(base, { isAdmin: false, canAssignCategory: true });
  assert.equal("parentProjectId" in p, false);
  assert.equal(p.categoryId, null);
  assert.equal(p.noSchedule, true);
  assert.equal(p.startDate, "");
});

test("non-manager payload omits categoryId", () => {
  const p = formValuesToPayload(base, { isAdmin: false, canAssignCategory: false });
  assert.equal("categoryId" in p, false);
  assert.equal("parentProjectId" in p, false);
});

test("admin payload maps none to null and ids to numbers", () => {
  assert.equal(formValuesToPayload(base, { isAdmin: true, canAssignCategory: true }).parentProjectId, 1);
  assert.equal(formValuesToPayload({ ...base, parentProjectId: "none", categoryId: "7" }, { isAdmin: true, canAssignCategory: true }).categoryId, 7);
  assert.equal(formValuesToPayload({ ...base, parentProjectId: "none" }, { isAdmin: true, canAssignCategory: true }).parentProjectId, null);
});
