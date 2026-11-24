import assert from "node:assert/strict";
import test from "node:test";
import { distribution, evaluateMixedAcceptance, loadSource, summarizeMixedRequests, sampleProcessTree } from "./common.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
test("backend resource sampling includes the process tree without reading environment or command lines", async () => {
  const child = spawn(process.execPath, ["-e", "process.send({ready:true});setInterval(()=>{},1000)"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  try {
    await once(child, "message");
    const result = await sampleProcessTree(process.pid, { includePss: true });
    assert.ok(result.rss > 0);
    assert.ok(result.processes.some(row => row.pid === process.pid));
    assert.ok(result.processes.some(row => row.pid === child.pid));
    assert.equal(result.rssOmissions, 0);
    assert.ok(result.pss === null || result.pss > 0);
    assert.ok(result.pssOmissions === 0 || result.pss === null);
    assert.ok(result.cpuTicks >= 0);
    await assert.rejects(sampleProcessTree("../invalid"), /invalid_process_id/);
  } finally { child.kill("SIGKILL"); await once(child, "exit"); }
});
test("resource-guard cancellation is not an application latency or HTTP error", () => {
  const rows = [
    { phase: "upload-50", operation: "upload", status: 201, elapsedMs: 50 },
    { phase: "upload-50", operation: "upload", status: 0, elapsedMs: 9000, abortedByGuard: true },
    { phase: "upload-50", operation: "upload", status: 500, elapsedMs: 60 },
    { phase: "upload-50", operation: "upload", status: 0, elapsedMs: 9001, abortedByGuard: false },
  ];
  const summary = summarizeMixedRequests(rows).find(row => row.phase === "upload-50");
  assert.equal(summary.latencyMs.n, 2);
  assert.equal(summary.latencyMs.p95, 60);
  assert.equal(summary.errors, 2);
  assert.equal(summary.httpErrors, 1);
  assert.equal(summary.transportFailures, 1);
  assert.equal(summary.guardAborts, 1);
});

test("percentiles expose sample count, empty input and nearest-rank tail", () => {
  assert.deepEqual(distribution([]), { n: 0, p50: null, p95: null, max: null });
  assert.deepEqual(distribution([NaN, 2, Infinity, 1]), { n: 2, p50: 1, p95: 2, max: 2 });
  const values = Array.from({ length: 100 }, (_, index) => index + 1).reverse();
  assert.deepEqual(distribution(values), { n: 100, p50: 50, p95: 95, max: 100 });
  assert.equal(values[0], 100, "summarizing evidence must not mutate raw observations");
});

test("mixed acceptance keeps the fixed idle-relative p95 bound and blocks thin samples", () => {
  const summaries = [
    { phase: "idle", operation: "files", latencyMs: { n: 30, p95: 60 } },
    { phase: "idle", operation: "report", latencyMs: { n: 30, p95: 20 } },
    { phase: "idle", operation: "project-edit", latencyMs: { n: 29, p95: 20 } },
    { phase: "upload-1", operation: "files", errors: 0, transportFailures: 0, latencyMs: { n: 30, p95: 100 } },
    { phase: "upload-10", operation: "files", errors: 0, transportFailures: 0, latencyMs: { n: 30, p95: 101 } },
    { phase: "upload-50", operation: "report", errors: 0, transportFailures: 0, latencyMs: { n: 4, p95: 20 } },
    { phase: "upload-1", operation: "project-edit", errors: 0, transportFailures: 0, latencyMs: { n: 30, p95: 20 } },
  ];
  const results = evaluateMixedAcceptance(summaries);
  assert.deepEqual(results.map(row => [row.thresholdMs, row.state]), [
    [100, "PASS"], [100, "FAIL"], [100, "BLOCKED"], [100, "BLOCKED"],
  ]);
});

test("benchmark loads the current shared policy without starting route workers", async () => {
  const policy = await loadSource("lib/api-zod/src/report-image-share.ts");
  assert.equal(policy.isAllowedReportImageDimensions(8000, 5000), true);
  assert.equal(policy.isAllowedReportImageDimensions(8001, 5000), false);
  assert.equal(policy.nextReportImageShareUploadCount(20, 20), null);
});
