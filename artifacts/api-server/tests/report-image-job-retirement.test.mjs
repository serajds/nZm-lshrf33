import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("legacy report image jobs are paused and cannot invoke a second image processor", async () => {
  const route = await readFile(new URL("../src/routes/reports.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/lib/report-image-optimization-job-store.ts", import.meta.url), "utf8");
  await assert.rejects(readFile(new URL("../src/lib/report-image-optimization-jobs.ts", import.meta.url), "utf8"),
    error => error.code === "ENOENT");
  assert.doesNotMatch(route, /\breportImageVariant\s*\(|createReportImageOptimizationJobs/);
  assert.match(route, /res\.status\(410\).*توقفت آلية تهيئة الصور القديمة/s);
  assert.match(store, /status: "paused"/);
  assert.match(store, /leaseOwner: null/);
  assert.match(store, /leaseUntil: null/);
  assert.match(store, /async getLatest/);
});
