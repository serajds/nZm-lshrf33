import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { planExcelActivityImport } from "../artifacts/api-server/src/lib/excel-activity-import.ts";

const requireFromApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const XLSX = requireFromApi("xlsx");
const header = ["اسم البند", "تاريخ البداية", "تاريخ النهاية", "النوع"];
const dateStart = "2026-01-01";
const dateEnd = "2026-01-31";

function excelRows(data) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...data]), "الأعمال");
  const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return XLSX.utils.sheet_to_json(XLSX.read(bytes, { type: "buffer", cellDates: true }).Sheets["الأعمال"], {
    header: 1, raw: false, dateNF: "yyyy-mm-dd", blankrows: true,
  });
}

test("without groups retains the legacy name/date validation and row order", () => {
  const plan = planExcelActivityImport(excelRows([
    ["أول", dateStart, dateEnd], ["بدون تاريخ"], ["ثانٍ", dateStart, dateEnd],
  ]), "none", []);
  assert.deepEqual(plan.rows.map(row => [row.kind, row.name, row.groupRow ?? null]), [
    ["activity", "أول", null], ["error", "بدون تاريخ", null], ["activity", "ثانٍ", null],
  ]);
  assert.equal(plan.groups.length, 0);
  assert.deepEqual(plan.counts, { activities: 2, rejected: 1 });
});

test("sequential inferred groups, activities before first group, and repeated names", () => {
  const plan = planExcelActivityImport(excelRows([
    ["قبل المجموعة", dateStart, dateEnd],
    ["الأساسات"], ["حفر", dateStart, dateEnd], ["قواعد", dateStart, dateEnd],
    ["الهيكل"], ["أعمدة", dateStart, dateEnd],
    ["الأساسات"], ["ميدات", dateStart, dateEnd],
  ]), "detect", []);
  assert.deepEqual(plan.rows.map(row => [row.rowNumber, row.kind, row.groupRow ?? null]), [
    [2, "activity", null], [3, "group", null], [4, "activity", 3], [5, "activity", 3],
    [6, "group", null], [7, "activity", 6], [8, "group", null], [9, "activity", 8],
  ]);
  assert.deepEqual(plan.groups.map(group => group.name), ["الأساسات", "الهيكل", "الأساسات"]);
});

test("optional type explicitly overrides inference but never permits invalid activities", () => {
  const plan = planExcelActivityImport(excelRows([
    ["قسم", "", "", "مجموعة"], ["عمل", dateStart, dateEnd, "نشاط"],
    ["ملتبس", "", "", "نشاط"], ["عنوان بتاريخ", dateStart, dateEnd, "مجموعة"],
    ["نوع غير معروف", dateStart, dateEnd, "تعليق"],
  ]), "detect", []);
  assert.deepEqual(plan.rows.map(row => row.kind), ["group", "activity", "error", "error", "error"]);
  assert.equal(plan.rows[2].error.includes("تاريخ البداية"), true);
  assert.equal(plan.counts.rejected, 3);
});

test("incomplete or ambiguous row is rejected and does not inherit the previous group", () => {
  const plan = planExcelActivityImport(excelRows([
    ["مجموعة"], ["سليم", dateStart, dateEnd],
    ["عنوان ناقص", dateStart], ["بعد الالتباس", dateStart, dateEnd],
    ["عنوان مع معلومات", "", "", "", "ملاحظة"], ["بعده", dateStart, dateEnd],
  ]), "detect", []);
  assert.deepEqual(plan.rows.map(row => row.kind), ["group", "activity", "error", "activity", "error", "activity"]);
  assert.equal(plan.rows[3].groupRow, null);
  assert.equal(plan.rows[5].groupRow, null);
});

test("matched project group is offered, including whitespace/case normalization", () => {
  const plan = planExcelActivityImport(excelRows([
    ["  أعمال   الأساسات  "], ["حفر", dateStart, dateEnd],
  ]), "detect", [{ id: 17, name: "أعمال الأساسات" }]);
  assert.deepEqual(plan.groups[0].matches, [{ id: 17, name: "أعمال الأساسات" }]);
});

test("existing-group mode assigns all valid rows to its selected target at save, without inferred groups", () => {
  const plan = planExcelActivityImport(excelRows([
    ["أول", dateStart, dateEnd], ["ثانٍ", dateStart, dateEnd],
  ]), "existing", [{ id: 17, name: "الأعمال" }]);
  assert.deepEqual(plan.rows.map(row => row.kind), ["activity", "activity"]);
  assert.deepEqual(plan.groups, []);
});

test("blank rows retain their Excel row numbers, and invalid date order is unchanged", () => {
  const plan = planExcelActivityImport(excelRows([
    [], ["قسم"], ["صالح", dateStart, dateEnd], ["مقلوب", dateEnd, dateStart],
  ]), "detect", []);
  assert.deepEqual(plan.rows.map(row => row.rowNumber), [3, 4, 5]);
  assert.equal(plan.rows[2].kind, "error");
});

test("preview/confirm are protected and old ungrouped import remains available", () => {
  const route = readFileSync(new URL("../artifacts/api-server/src/routes/activities.ts", import.meta.url), "utf8");
  for (const path of ["/import/preview", "/import/confirm", "/import"]) {
    assert.ok(route.includes(`router.post("/projects/:projectId/activities${path}", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities")`));
  }
  assert.ok(route.includes("createdNames.get(nameKey)"), "repeated group headers should reuse one created group");
  assert.ok(route.includes("if (!choice && matches.map(item => item.id).join"), "stale preview should not create duplicates");
  assert.ok(route.includes('choice?.action === "existing" && !matches.some(match => match.id === choice.groupId)'), "a deleted or renamed chosen group must never turn into a new group");
  assert.ok(route.includes("preview.completed = completed"), "repeat confirm must return the same saved result");
  assert.ok(route.includes('throw new Error("IMPORT_FORBIDDEN")'), "restricted engineers must not import outside their assigned groups");
  assert.ok(route.includes("preview.targetGroupName"), "renamed destinations must require a fresh preview");
});