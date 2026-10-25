import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../../construction-supervision/src/lib/report-pdf.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { buildPrintHTML } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const report = {
  projectName: "اختبار", reportType: "period", reportDate: "2026-10-25",
  periodStart: "2026-09-01", periodEnd: "2026-09-30",
  progressPercentage: 40, workDescription: "أعمال الفترة", reportId: 1,
  actualProgress: 60, plannedProgress: 50, spi: 0.8,
  startDate: "2026-01-01", expectedEndDate: "2026-12-31",
  snapshotAvailable: true, actualHistoricalUnverified: true, activities: [],
};
test("manual report print uses approved 40% rather than snapshot 60% for variance and SPI", () => {
  const html = buildPrintHTML({ ...report, approvedProgress: true });
  assert.match(html, /-10%/);
  assert.match(html, />SPI<\/span>/);
  assert.match(html, /0\.8/);
  assert.match(html, /الإنجاز حتى نهاية الفترة/);
  assert.doesNotMatch(html, /معتمدة يدوياً/);
  assert.doesNotMatch(html, /مؤشر SPI التاريخي غير متاح/);
});
test("legacy unverified report behavior remains unchanged without manual approval", () => {
  const html = buildPrintHTML(report);
  assert.doesNotMatch(html, /مؤشر SPI التاريخي غير متاح/);
  assert.doesNotMatch(html, />SPI<\/span>/);
});
test("manual aggregate remains printable without inventing an activity snapshot or plan", () => {
  const html = buildPrintHTML({ ...report, approvedProgress: true, snapshotAvailable: false, actualProgress: null, plannedProgress: null, spi: null });
  assert.match(html, /الإنجاز حتى نهاية الفترة/);
  assert.doesNotMatch(html, /معتمدة يدوياً/);
  assert.doesNotMatch(html, />SPI<\/span>/);
});

test("legacy reference shows work and schedule without presenting missing progress as zero or SPI", () => {
  const html = buildPrintHTML({
    ...report, actualProgress: null, plannedProgress: null, plannedHistoricalUnverified: true, spi: null,
    activities: [{
      name: "بند مرجعي", actualProgress: 0, plannedProgress: 70, status: "unknown",
      actualHistoricalUnverified: true, plannedHistoricalUnverified: true,
      plannedStartDate: "2026-09-01", plannedEndDate: "2026-09-30",
    }],
  });
  assert.match(html, /بند مرجعي/);
  assert.match(html, /البرنامج الزمني/);
  assert.doesNotMatch(html, /جدول مرجعي|غير موثق للفترة|تغيّر تاريخ التقرير|الخطط المحفوظة|لقطة وقت الإنشاء/);
  assert.doesNotMatch(html, /لا توجد لقطة أنشطة محفوظة/);
  assert.doesNotMatch(html, />SPI<\/span>/);
});
