import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
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

function clone(row) {
  return { ...row, items: row.items.map(item => ({ ...item })) };
}

function createMemoryStore() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    async start(projectId, items) {
      const active = rows.find(row => row.status === "running");
      if (active) {
        return {
          job: active.projectId === projectId ? this.view(active) : null,
          blockedByOtherProject: active.projectId !== projectId,
        };
      }
      const now = new Date().toISOString();
      const row = {
        id: String(nextId++), projectId, status: items.length ? "running" : "completed",
        items: items.map(item => ({ ...item })), total: items.length, processed: 0,
        optimized: 0, skipped: 0, failed: 0, nextIndex: 0, current: null,
        startedAt: now, finishedAt: items.length ? null : now, lastError: null,
        leaseOwner: null, leaseUntil: null,
      };
      rows.push(row);
      return { job: this.view(row), blockedByOtherProject: false };
    },
    async claim(workerId) {
      const now = Date.now();
      const row = rows.find(candidate => candidate.status === "running"
        && (!candidate.leaseUntil || candidate.leaseUntil <= now));
      if (!row) return null;
      row.leaseOwner = workerId;
      row.leaseUntil = now + 120_000;
      return clone(row);
    },
    async getOwned(id, workerId) {
      const row = rows.find(candidate => candidate.id === id && candidate.status === "running"
        && candidate.leaseOwner === workerId);
      return row ? clone(row) : null;
    },
    async setCurrent(id, workerId, filename) {
      const row = rows.find(candidate => candidate.id === id && candidate.leaseOwner === workerId);
      if (row) row.current = filename;
    },
    async renewLease(id, workerId) {
      const row = rows.find(candidate => candidate.id === id && candidate.leaseOwner === workerId);
      if (row) row.leaseUntil = Date.now() + 120_000;
    },
    async advance(id, workerId, result) {
      const row = rows.find(candidate => candidate.id === id && candidate.leaseOwner === workerId);
      if (!row) return;
      row.nextIndex++;
      row.processed++;
      row.current = null;
      if (result === "optimized") row.optimized++;
      else if (result === "skipped") row.skipped++;
      else {
        row.failed++;
        row.lastError = "تعذّر تجهيز صورة واحدة أو أكثر؛ أعد المحاولة";
      }
    },
    async finish(id, workerId, status) {
      const row = rows.find(candidate => candidate.id === id && candidate.leaseOwner === workerId);
      if (!row) return;
      row.status = status;
      row.current = null;
      row.leaseOwner = null;
      row.leaseUntil = null;
      row.finishedAt = new Date().toISOString();
    },
    async getLatest(projectId) {
      const row = [...rows].reverse().find(candidate => candidate.projectId === projectId);
      return row ? this.view(row) : null;
    },
    view(row) {
      const { items: _items, nextIndex: _nextIndex, leaseOwner: _leaseOwner, leaseUntil: _leaseUntil, ...view } = row;
      return { ...view };
    },
  };
}

const items = names => names.map(filename => ({ filename, fileSize: 200_000 }));

test("persistent job processing is sequential and records per-image outcomes", async () => {
  const store = createMemoryStore();
  let active = 0;
  let peak = 0;
  const jobs = createReportImageOptimizationJobs(store, async (_projectId, item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return item.filename === "b.jpg" ? "skipped" : "optimized";
  }, { autoStart: false });

  const started = await jobs.start(7, items(["a.jpg", "b.jpg", "c.jpg"]));
  assert.equal(started.job.status, "running");
  await jobs.runOnce();
  const completed = await jobs.get(7);
  assert.equal(peak, 1);
  assert.equal(completed.status, "completed");
  assert.equal(completed.processed, 3);
  assert.equal(completed.optimized, 2);
  assert.equal(completed.skipped, 1);
  assert.equal(completed.failed, 0);
  assert.equal(completed.current, null);
});

test("the shared store prevents duplicate active jobs across project requests", async () => {
  const store = createMemoryStore();
  const jobs = createReportImageOptimizationJobs(store, async () => "optimized", { autoStart: false });
  const first = await jobs.start(1, items(["a.jpg"]));
  const sameProject = await jobs.start(1, items(["different.jpg"]));
  const otherProject = await jobs.start(2, items(["b.jpg"]));
  assert.equal(first.job.id, sameProject.job.id);
  assert.equal(otherProject.blockedByOtherProject, true);
  assert.equal(store.rows.length, 1);
});

test("a new worker resumes the unfinished cursor after the prior process stops", async () => {
  const store = createMemoryStore();
  const started = await store.start(3, items(["done.jpg", "resume.jpg", "later.jpg"]));
  const row = store.rows.find(candidate => candidate.id === started.job.id);
  row.nextIndex = 1;
  row.processed = 1;
  row.optimized = 1;
  const resumed = [];
  const restartedProcess = createReportImageOptimizationJobs(store, async (_projectId, item) => {
    resumed.push(item.filename);
    return "optimized";
  }, { autoStart: false });
  await restartedProcess.runOnce();

  assert.deepEqual(resumed, ["resume.jpg", "later.jpg"]);
  const completed = await restartedProcess.get(3);
  assert.equal(completed.status, "completed");
  assert.equal(completed.processed, 3);
  assert.equal(completed.optimized, 3);
});

test("one failed image does not stop the remaining persisted job", async () => {
  const store = createMemoryStore();
  const jobs = createReportImageOptimizationJobs(store, async (_projectId, item) => {
    if (item.filename === "bad.jpg") throw new Error("private source detail");
    return "optimized";
  }, { autoStart: false });
  await jobs.start(4, items(["bad.jpg", "good.jpg"]));
  await jobs.runOnce();
  const completed = await jobs.get(4);
  assert.equal(completed.status, "completed_with_errors");
  assert.equal(completed.failed, 1);
  assert.equal(completed.optimized, 1);
  assert.equal(completed.processed, 2);
  assert.equal(completed.lastError, "تعذّر تجهيز صورة واحدة أو أكثر؛ أعد المحاولة");
  assert.doesNotMatch(completed.lastError, /private source detail/);
});

test("PostgreSQL job storage is globally locked and uses an expiring lease", async () => {
  const storeSource = await readFile(new URL("../src/lib/report-image-optimization-job-store.ts", import.meta.url), "utf8");
  const schemaSource = await readFile(new URL("../../../lib/db/src/schema/report_image_optimization_jobs.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../../../lib/db/migrations/0017_report_image_optimization_jobs.sql", import.meta.url), "utf8");
  assert.match(storeSource, /pg_advisory_xact_lock/);
  assert.match(storeSource, /leaseUntil/);
  assert.match(storeSource, /lte\(reportImageOptimizationJobsTable\.leaseUntil, now\)/);
  assert.match(schemaSource, /one_running_idx/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS report_image_optimization_jobs_one_running_idx/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS report_image_optimization_jobs/);
});
