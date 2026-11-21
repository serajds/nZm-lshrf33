import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectReportSnapshotActivities } from "../artifacts/api-server/src/lib/report-snapshot-selection.ts";

const reportRoute = readFileSync(new URL("../artifacts/api-server/src/routes/reports.ts", import.meta.url), "utf8");
const reportPage = readFileSync(new URL("../artifacts/construction-supervision/src/pages/projects/[id]/reports.tsx", import.meta.url), "utf8");
const reportPdf = readFileSync(new URL("../artifacts/construction-supervision/src/lib/report-pdf.ts", import.meta.url), "utf8");
const serverPdf = readFileSync(new URL("../artifacts/api-server/src/routes/pdf.ts", import.meta.url), "utf8");

test("snapshot selection excludes not-started items without mutating the activity list", () => {
  const activities = [
    { id: 1, origin: "manual", status: "not_started", actualProgress: 0 },
    { id: 2, origin: "imported", status: "not_started", actualProgress: 0 },
    { id: 3, origin: "manual", status: "in_progress", actualProgress: 35 },
    { id: 4, origin: "imported", status: "completed", actualProgress: 100 },
    { id: 5, origin: "linked", externalSourceGroupId: 12, status: "in_progress", actualProgress: 20 },
    { id: 6, origin: "generated", externalSourceGroupId: 13, status: "completed", actualProgress: 100 },
    { id: 7, origin: "linked", externalSourceGroupId: 14, status: "not_started", actualProgress: 50 },
    { id: 8, origin: "manual", status: "delayed", actualProgress: 50 },
  ];
  assert.deepEqual(selectReportSnapshotActivities(activities).map(a => a.id), [3, 4, 5, 6]);
  assert.equal(activities.length, 8, "selection must not mutate the project's activities");
});

test("new reports use the period snapshot; previews and PDFs use saved rows", () => {
  assert.match(reportRoute, /getReportPeriodProgress\(projectId, periodEnd, new Date\(\), periodStart\)/);
  assert.match(reportRoute, /const snapshot = progress\.activities/);
  assert.match(reportRoute, /activitiesSnapshot: snapshot/);
  assert.match(reportRoute, /const existing = \(current\.snapshot \?\? \(validReportDay\(approvalDay\)/);
  assert.match(reportRoute, /mergeSnapshot\(existing, body\.activitiesSnapshot, approvalDay\)/);
  assert.match(reportPage, /snapshotRows\.map\(row =>/);
  assert.match(reportPage, /const sourceActivities: ReportActivitiesSnapshotItem\[\] = hasSnapshot \? snapshotActivities : \[\]/);
  assert.match(reportPdf, /@page \{ size: A4 portrait; margin: 12mm 14mm 14mm 14mm; \}/);
  assert.match(serverPdf, /size: "A4"/);
  assert.match(serverPdf, /const reportSnapshot = Array\.isArray\(report\.activitiesSnapshot\)/);
  assert.match(serverPdf, /for \(const \[activityIndex, activity\] of reportSnapshot\.entries\(\)\)/);
});