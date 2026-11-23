import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-image-optimization-jobs.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const { createReportImageOptimizationJobs } = module.exports;

async function waitForCompletion(manager, projectId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = manager.get(projectId);
    if (job?.status !== "running") return job;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw new Error("Optimization job did not complete");
}

test("legacy image optimization runs sequentially and reports a resumable summary", async () => {
  const jobs = createReportImageOptimizationJobs();
  let active = 0;
  let peak = 0;
  const started = jobs.start(7, ["a.jpg", "b.jpg", "c.jpg"], async filename => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return filename === "b.jpg" ? "skipped" : "optimized";
  });
  assert.equal(started.started, true);
  assert.equal(started.job.status, "running");
  const completed = await waitForCompletion(jobs, 7);
  assert.equal(peak, 1);
  assert.equal(completed.status, "completed");
  assert.equal(completed.processed, 3);
  assert.equal(completed.optimized, 2);
  assert.equal(completed.skipped, 1);
  assert.equal(completed.failed, 0);
  assert.equal(completed.current, null);
});

test("only one project's bounded image-processing job runs at a time", async () => {
  const jobs = createReportImageOptimizationJobs();
  let release;
  const first = jobs.start(1, ["a.jpg"], async () => new Promise(resolve => { release = () => resolve("optimized"); }));
  assert.equal(first.started, true);
  const blocked = jobs.start(2, ["b.jpg"], async () => "optimized");
  assert.equal(blocked.started, false);
  assert.equal(blocked.blockedByOtherProject, true);
  release();
  await waitForCompletion(jobs, 1);
  assert.equal(jobs.getActiveProjectId(), null);
});

test("failed images are isolated and summarized without stopping the remaining batch", async () => {
  const jobs = createReportImageOptimizationJobs();
  jobs.start(3, ["bad.jpg", "good.jpg"], async filename => {
    if (filename === "bad.jpg") throw new Error("bad image");
    return "optimized";
  });
  const completed = await waitForCompletion(jobs, 3);
  assert.equal(completed.status, "completed_with_errors");
  assert.equal(completed.failed, 1);
  assert.equal(completed.optimized, 1);
  assert.equal(completed.processed, 2);
  assert.equal(completed.lastError, "تعذّر تجهيز صورة واحدة أو أكثر؛ أعد المحاولة");
});
