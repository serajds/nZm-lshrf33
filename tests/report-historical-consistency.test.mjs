import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcActivityPlannedProgress, calcSPI, hasValidProjectSchedule, utcDayDifference } from "../artifacts/api-server/src/lib/progress.ts";

const reportRoute = readFileSync(new URL("../artifacts/api-server/src/routes/reports.ts", import.meta.url), "utf8");
const periodProgress = readFileSync(new URL("../artifacts/api-server/src/lib/report-period-progress.ts", import.meta.url), "utf8");
const pdfRoute = readFileSync(new URL("../artifacts/api-server/src/routes/pdf.ts", import.meta.url), "utf8");
const reportPage = readFileSync(new URL("../artifacts/construction-supervision/src/pages/projects/[id]/reports.tsx", import.meta.url), "utf8");
const reportPdf = readFileSync(new URL("../artifacts/construction-supervision/src/lib/report-pdf.ts", import.meta.url), "utf8");

test("report activity plan is calculated at the saved period end date", () => {
  const asOf = new Date("2026-04-06T00:00:00.000Z");
  assert.equal(calcActivityPlannedProgress({
    plannedStartDate: "2026-04-01",
    plannedEndDate: "2026-04-11",
  }, asOf), 50);
  assert.match(reportRoute, /getReportPeriodProgress\(projectId, periodEnd, new Date\(\), periodStart\)/);
  assert.match(reportRoute, /progressAsOfDate: periodEnd/);
  assert.match(reportRoute, /const snapshot = progress\.activities/);
  assert.match(reportRoute, /activitiesSnapshot: snapshot/);
  assert.match(periodProgress, /const asOf = new Date\(`\$\{day\}T00:00:00Z`\)/);
  assert.match(periodProgress, /plannedAsOfDate: day/);
  assert.match(periodProgress, /plannedProgress: hasSchedule \? resolved\.plannedProgress : 0/);
});

test("linked activity plan keeps the resolver's source snapshot instead of using target dates", () => {
  assert.equal(calcActivityPlannedProgress({
    plannedStartDate: "2026-04-01",
    plannedEndDate: "2026-04-11",
    externalSourceGroupId: 17,
    plannedProgress: 63,
  }, new Date("2026-04-06T00:00:00.000Z")), 63);
  assert.match(pdfRoute, /resolveLinkedActivityProgress\(activityRows, currentAsOf\)/);
});

test("projects without a valid schedule suppress planned progress and SPI comparisons", () => {
  assert.equal(hasValidProjectSchedule(null, "2026-05-01"), false);
  assert.equal(hasValidProjectSchedule("invalid", "2026-05-01"), false);
  assert.equal(hasValidProjectSchedule("2026-05-02", "2026-05-01"), false);
  assert.equal(hasValidProjectSchedule("2026-05-01", "2026-05-02"), true);
  assert.equal(utcDayDifference("2026-05-04T23:59:00-07:00", "2026-05-01T00:00:00Z"), 4);
  assert.match(periodProgress, /const hasSchedule = !rootSnapshot\.noSchedule && hasValidProjectSchedule\(rootSnapshot\.startDate, rootSnapshot\.expectedEndDate\)/);
  assert.match(periodProgress, /plannedProgress = hasSchedule && !activities\.some\(a => a\.plannedHistoricalUnverified\)/);
  assert.match(pdfRoute, /hasValidProjectSchedule\(project\.startDate, project\.expectedEndDate\)/);
  assert.match(pdfRoute, /utcDayDifference\(project\.expectedEndDate!, project\.startDate!\)/);
  assert.match(reportPdf, /hasValidSchedule\(data\.startDate, data\.expectedEndDate, data\.noSchedule\)/);
  assert.match(reportPdf, /deviation = !plannedUnverified && plannedPct != null/);
  assert.match(reportPage, /noSchedule: project\.noSchedule === true/);
});

test("report creation keeps the manually reported percentage separate from its snapshot", () => {
  assert.match(reportRoute, /progressPercentage: manual \? progressPercentage : progress\.overallProgress!/);
  assert.match(reportRoute, /activitiesSnapshot: snapshot/);
});

test("historical report exports use saved snapshots and explicitly flag unavailable legacy data", () => {
  assert.match(pdfRoute, /Array\.isArray\(report\.activitiesSnapshot\)/);
  assert.match(pdfRoute, /بيانات التقدم التاريخية غير متاحة لهذا التقرير القديم/);
  assert.match(pdfRoute, /لقطة الأنشطة المحفوظة للتقرير/);
  assert.match(pdfRoute, /snapshotActualIsHistoricallyUnverified/);
  assert.match(pdfRoute, /فعلي المسجل عند الإنشاء/);
  assert.match(reportPage, /const sourceActivities: ReportActivitiesSnapshotItem\[\] = hasSnapshot \? snapshotActivities : \[\]/);
  assert.match(reportPage, /actualHistoricalUnverified/);
  assert.doesNotMatch(reportPage, /snapshotActivities \?\? \(activities \?\? \[\]\)/);
  assert.match(reportPdf, /snapshotAvailable\?: boolean/);
  assert.match(reportPdf, /actualHistoricalUnverified\?: boolean/);
  assert.match(reportPdf, /data\.snapshotAvailable !== false/);
});

test("SPI is unavailable when a saved historical snapshot has no planned progress", () => {
  assert.equal(calcSPI(0, 0), null);
  assert.equal(calcSPI(20, 10), 0.5);
  assert.match(reportRoute, /return totalWeight > 0 \? weightedSum \/ totalWeight : 0/);
  assert.match(pdfRoute, /return totalWeight > 0 \? weightedProgress \/ totalWeight : 0/);
  assert.match(pdfRoute, /calcSPI\(rawHistoricalPlanned, rawHistoricalActual\)/);
  assert.match(reportPage, /return totalWeight > 0 \? weighted \/ totalWeight : 0/);
  assert.match(reportPage, /\(periodSource === "manual" \? fullReport\.progressPercentage : snapshotActual\) \/ snapshotPlanned/);
  assert.match(reportPage, /snapshotPlanned != null && snapshotPlanned > 0 && snapshotActual != null/);
  assert.match(reportPage, /weighted \/ totalWeight/);
  assert.match(reportPdf, /Math\.round\(Math\.min\(100, Math\.max\(0, data\.plannedProgress\)\) \* 10\) \/ 10/);
  assert.match(pdfRoute, /actualUnverified \|\| plannedUnavailable\s*\?\s*null/);
  assert.match(reportPage, /plannedHistoricalUnverified: hasUnverifiedPlan/);
});