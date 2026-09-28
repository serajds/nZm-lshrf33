import assert from "node:assert/strict";
import test from "node:test";
import { buildReportAiContext } from "../src/lib/report-ai-context.ts";
import { buildReportAiPrompt, reportEditorInstruction } from "../src/lib/report-ai-prompt.ts";

test("report editor prompt keeps the full snapshot context and directs owner-ready prose", () => {
  const snapshotContext = buildReportAiContext([
    {
      id: 1, name: "أعمال العزل", status: "in_progress",
      plannedProgress: 70, actualProgress: 50,
      plannedAsOfDate: "2026-09-15", actualRecordedAt: "2026-09-15T09:00:00Z",
      actualStartDate: "2026-09-03", plannedEndDate: "2026-09-30",
    },
    {
      id: 2, name: "أعمال الكهرباء", status: "completed",
      plannedProgress: 100, actualProgress: 100,
      plannedAsOfDate: "2026-09-15", actualRecordedAt: "2026-09-15T09:00:00Z",
      actualEndDate: "2026-09-12",
    },
  ], "2026-09-15", new Map([[1, "المبنى الرئيسي"], [2, "المبنى الرئيسي"]]));
  const prompt = buildReportAiPrompt({
    periodStart: "2026-09-01",
    periodEnd: "2026-09-15",
    reportDate: "2026-09-15",
    snapshotContext,
    imageGroupsSummary: "- الأعمال الجارية (2 صورة)",
    technicalNotes: "تأخر توريد مواد العزل بحسب سجل المشرف.",
    recommendations: "متابعة توريد المواد.",
  });
  assert.ok(prompt.includes(JSON.stringify(snapshotContext)), "the complete structured context must remain intact");
  assert.match(prompt, /أعمال العزل/);
  assert.match(prompt, /أعمال الكهرباء/);
  assert.match(prompt, /الأعمال الجارية \(2 صورة\)/);
  assert.match(prompt, /تأخر توريد مواد العزل بحسب سجل المشرف/);
  assert.match(prompt, /متابعة توريد المواد/);
  assert.match(prompt, /مثال أسلوبي فقط/);
  assert.match(prompt, /لا تنقل منه أي عمل/);
  assert.match(prompt, /لا تكرر المعلومة/);
  assert.match(prompt, /لا تضف تصنيفات بين أقواس مربعة/);
  assert.match(reportEditorInstruction, /مهندس استشاري/);
  assert.doesNotMatch(prompt, /ميّز صراحة بين الحقيقة الرقمية والاستنتاج/);
  assert.doesNotMatch(reportEditorInstruction, /ميّز الحقيقة الرقمية من الاستنتاج/);
});