import assert from "node:assert/strict";
import test from "node:test";
import { reportTypeLabel, suggestedReportPeriodEnd } from "../src/lib/report-types.ts";

test("all report types have explicit labels, including custom periods", () => {
  assert.equal(reportTypeLabel("weekly"), "أسبوعي");
  assert.equal(reportTypeLabel("monthly"), "شهري");
  assert.equal(reportTypeLabel("period"), "بالفترة");
});

test("custom periods never generate or override an end date", () => {
  for (const start of ["2026-10-01", "2026-10-20", ""]) {
    assert.equal(suggestedReportPeriodEnd("period", start), null);
  }
});

test("weekly and monthly suggestions retain their existing behavior", () => {
  assert.equal(suggestedReportPeriodEnd("weekly", "2026-10-01"), "2026-10-07");
  assert.equal(suggestedReportPeriodEnd("monthly", "2026-10-01"), "2026-10-31");
  assert.equal(suggestedReportPeriodEnd("weekly", ""), null);
});
