import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { isolatedPostgres } from "../../tests/helpers/isolated-postgres.mjs";
import {
  evaluateMixedAcceptance, fixtures, output, root, loadSource, save,
  summarizeMixedRequests, sampleProcessTree,
} from "./common.mjs";
import { mixedUploadRepetitions, runMixedClients } from "./mixed-clients.mjs";

assert.equal(process.env.NODE_ENV, "development");
assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID, "Separate development bucket required");
assert.ok(process.env.IMAGE_AUDIT_BUCKET_ID !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Separate test storage required");
await fixtures();
const pg = await isolatedPostgres();
await mkdir(output, { recursive: true });
const cwd = await mkdtemp(path.join(output, "mixed-api-"));
const { objectStorageClient } = await loadSource("artifacts/api-server/src/lib/objectStorage.ts");
const bucket = objectStorageClient.bucket(process.env.IMAGE_AUDIT_BUCKET_ID);
const written = new Set();
let latest = null, result, guardReason = null, samplerError = null;
let rssOmissionCount = 0, discoveryOmissionCount = 0;
let cleanupResult = { attempted: 0, deleteFailures: 0, stillPresent: 0, verifiedAbsent: 0 };
const rssOmissionReasons = {
  ownedPidMissingStat: 0, missingVmRss: 0, statusPermissionDenied: 0,
  missingStatm: 0, invalidStatm: 0, zeroStatm: 0,
  missingSmapsRollup: 0, invalidSmapsRollup: 0, zeroSmapsRollup: 0,
};
const rssOmissionStates = {};
let peakRss = 0, apiPeakRss = 0, processCountPeak = 0, cpuTicksPeak = 0;
let peakPss = 0, apiPeakPss = 0, workerTreePeakRss = 0, workerTreePeakPss = 0;
let pssSampleCount = 0, pssOmissionCount = 0, guardMemoryFallbackSamples = 0, sampleSequence = 0;
const memoryTimeline = [];
let lastMemoryTimelineAt = 0;
const clockTicksPerSecond = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());
assert.ok(clockTicksPerSecond > 0);
let clients, clientRun;
const stopClients = new AbortController();
const targetUploadCount = Object.entries(mixedUploadRepetitions)
  .reduce((total, [size, repetitions]) => total + Number(size) * repetitions, 0);
try {
  result = await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./mixed-worker.mjs", import.meta.url)), [cwd], {
      cwd: root, stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, IMAGE_AUDIT_CHILD: "isolated-mixed", LOG_LEVEL: "silent" },
      execArgv: ["--max-old-space-size=384", "--import", path.join(root, "scripts/node_modules/tsx/dist/loader.mjs")],
    });
    const began = performance.now();
    child.on("error", reject);
    child.on("message", message => {
      if (message.kind === "object") {
        // Exact write ledger only; never sweep or list/delete a bucket.
        assert.match(message.key, /^uploads\/[a-zA-Z0-9._/-]+$/);
        assert.ok(!message.key.includes(".."));
        written.add(message.key);
      } else if (message.kind === "ready") {
        // Capability-bearing setup stays in memory, outside saved results.
        clientRun = runMixedClients(message, stopClients.signal).then(data => {
          clients = data;
          if (child.connected) child.send({ kind: "stop" });
        });
      } else if (message.kind === "snapshot" || message.kind === "result") latest = message;
    });
    let sampling = false, emptySamples = 0;
    const timer = setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try {
        const includePss = ++sampleSequence % 4 === 0;
        const tree = await sampleProcessTree(child.pid, { includePss });
        if (!tree.processes.some(row => row.pid === child.pid)) {
          if (++emptySamples < 3) return; // Allow a normally exiting /proc entry.
          throw new Error("resource_sampler_unavailable");
        }
        emptySamples = 0;
        rssOmissionCount += tree.rssOmissions;
        discoveryOmissionCount += tree.discoveryOmitted;
        for (const reason of Object.keys(rssOmissionReasons)) rssOmissionReasons[reason] += tree.rssOmissionReasons[reason];
        for (const [state, count] of Object.entries(tree.rssOmissionStates)) {
          rssOmissionStates[state] = (rssOmissionStates[state] ?? 0) + count;
        }
        const rss = tree.rss;
        peakRss = Math.max(peakRss, rss);
        const apiProcess = tree.processes.find(row => row.pid === child.pid);
        const workerProcesses = tree.processes.filter(row => row.pid !== child.pid);
        apiPeakRss = Math.max(apiPeakRss, apiProcess?.rss ?? 0);
        workerTreePeakRss = Math.max(workerTreePeakRss, workerProcesses.reduce((sum, row) => sum + row.rss, 0));
        if (includePss) {
          pssOmissionCount += tree.pssOmissions;
          if (tree.pss !== null) {
            pssSampleCount++;
            peakPss = Math.max(peakPss, tree.pss);
            apiPeakPss = Math.max(apiPeakPss, apiProcess?.pssBytes ?? 0);
            workerTreePeakPss = Math.max(workerTreePeakPss,
              workerProcesses.reduce((sum, row) => sum + (row.pssBytes ?? 0), 0));
          }
        }
        const elapsedMs = performance.now() - began;
        if (elapsedMs - lastMemoryTimelineAt >= 1000) {
          lastMemoryTimelineAt = elapsedMs;
          memoryTimeline.push({
            elapsedMs: Math.round(elapsedMs),
            phase: latest?.phase ?? "unknown",
            apiRssBytes: apiProcess?.rss ?? null,
            workerTreeRssBytes: workerProcesses.reduce((sum, row) => sum + row.rss, 0),
            treeRssBytes: rss,
            pssBytes: includePss ? tree.pss : null,
            apiHeapUsedBytes: latest?.memory?.heapUsed ?? null,
            apiExternalBytes: latest?.memory?.external ?? null,
            apiArrayBuffersBytes: latest?.memory?.arrayBuffers ?? null,
            processCount: tree.processes.length,
          });
        }
        processCountPeak = Math.max(processCountPeak, tree.processes.length);
        cpuTicksPeak = Math.max(cpuTicksPeak, tree.cpuTicks);
        let guardMemoryBytes = tree.pss;
        let guardMemoryBasis = "process_tree_pss";
        if (guardMemoryBytes === null && rss > 700 * 1024 * 1024) {
          const guardTree = await sampleProcessTree(child.pid, { includePss: true });
          guardMemoryBytes = guardTree.pss ?? guardTree.rss;
          guardMemoryBasis = guardTree.pss === null ? "rss_fallback_incomplete_pss" : "process_tree_pss";
          if (guardTree.pss === null) guardMemoryFallbackSamples++;
          else {
            pssSampleCount++;
            peakPss = Math.max(peakPss, guardTree.pss);
            const guardApi = guardTree.processes.find(row => row.pid === child.pid);
            const guardWorkers = guardTree.processes.filter(row => row.pid !== child.pid);
            apiPeakPss = Math.max(apiPeakPss, guardApi?.pssBytes ?? 0);
            workerTreePeakPss = Math.max(workerTreePeakPss,
              guardWorkers.reduce((sum, row) => sum + (row.pssBytes ?? 0), 0));
          }
        }
        if ((guardMemoryBytes !== null && guardMemoryBytes > 700 * 1024 * 1024)
          || performance.now() - began > 120_000) {
          guardReason = guardMemoryBytes > 700 * 1024 * 1024
            ? `${guardMemoryBasis}_safety_limit` : "120s_safety_limit";
          stopClients.abort();
          child.kill("SIGKILL");
        }
      } catch (error) {
        if (child.exitCode === null && child.signalCode === null) {
          guardReason = "resource_sampler_failed";
          samplerError = error instanceof Error ? error.message : "unknown";
          stopClients.abort(); child.kill("SIGKILL");
        }
      }
      finally { sampling = false; }
    }, 25);
    child.on("exit", code => {
      clearInterval(timer);
      stopClients.abort();
      resolve({
        code, guardReason, samplerError, rssOmissionCount, discoveryOmissionCount, rssOmissionReasons,
        peakRss, apiPeakRss, workerTreePeakRss, peakPss, apiPeakPss, workerTreePeakPss,
        pssSampleCount, pssOmissionCount, processCountPeak, rssOmissionStates, memoryTimeline,
        processTreeCpuMs: cpuTicksPeak * 1000 / clockTicksPerSecond,
        wallMs: performance.now() - began, snapshot: latest,
      });
    });
  });
  await clientRun;
} finally {
  // GCS requests can finish after an API process dies. Give those writes a
  // bounded settling interval, then delete only the exact recorded keys.
  if (guardReason) await new Promise(resolve => setTimeout(resolve, 2000));
  try {
    const ledger = await readFile(path.join(cwd, "written-objects.ndjson"), "utf8");
    for (const line of ledger.trim().split("\n").filter(Boolean)) {
      const key = JSON.parse(line);
      assert.match(key, /^uploads\/[a-zA-Z0-9._/-]+$/);
      assert.ok(!key.includes(".."));
      written.add(key);
    }
  } catch (error) { if (error.code !== "ENOENT") cleanupResult.deleteFailures++; }
  await save("mixed-cleanup-ledger.json", { keys: [...written], state: "pending", scope: "Only this private fixture process's recorded writes" });
  const keys = [...written];
  cleanupResult.attempted = keys.length;
  for (let offset = 0; offset < keys.length; offset += 8) {
    await Promise.all(keys.slice(offset, offset + 8).map(async key => {
      let deleted = false;
      for (let attempt = 0; attempt < 5 && !deleted; attempt++) {
        try {
          await bucket.file(key).delete({ ignoreNotFound: true });
          deleted = true;
        } catch {
          if (attempt === 4) cleanupResult.deleteFailures++;
          else await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
        }
      }
      try {
        const [exists] = await bucket.file(key).exists();
        if (exists) cleanupResult.stillPresent++;
      } catch {
        cleanupResult.stillPresent++;
      }
    }));
  }
  cleanupResult.verifiedAbsent = cleanupResult.attempted - cleanupResult.stillPresent;
  await save("mixed-cleanup.json", cleanupResult);
  await save("mixed-cleanup-ledger.json", {
    keys, state: cleanupResult.deleteFailures || cleanupResult.stillPresent ? "needs_recovery" : "verified_absent",
    scope: "Only this private fixture process's recorded writes",
  });
  await pg.stop();
  await rm(cwd, { recursive: true, force: true });
}
const requests = clients?.requests ?? [];
const summary = summarizeMixedRequests(requests);
const acceptance = evaluateMixedAcceptance(summary);
const routeRunFailed = result.code !== 0 || clients?.setupFailure
  || summary.some(row => row.errors !== 0);
const memorySamplingStatus = rssOmissionCount === 0 && pssOmissionCount === 0 && pssSampleCount > 0
  ? "PASS" : "BLOCKED";
const cleanupStatus = cleanupResult.deleteFailures === 0 && cleanupResult.stillPresent === 0
  ? "PASS" : "BLOCKED";
const status = guardReason === "resource_sampler_failed" ? "INVALID"
  : guardReason ? "BLOCKED"
    : routeRunFailed || acceptance.some(row => row.state === "FAIL") ? "FAIL"
      : acceptance.some(row => row.state === "BLOCKED") || memorySamplingStatus === "BLOCKED"
        || cleanupStatus === "BLOCKED" ? "BLOCKED" : "PASS";
await save("mixed-baseline.json", {
  recordedAt: new Date().toISOString(),
  memoryAccounting: "sampled_api_process_tree_sum_rss_including_instrumentation_children_excluding_clients",
  memoryGuard: {
    thresholdMiB: 700, primaryMetric: "process-tree PSS",
    fallbackMetric: "sum RSS only when a PSS sample is incomplete",
    fallbackSamples: guardMemoryFallbackSamples,
  },
  status,
  routeRunStatus: routeRunFailed ? "FAIL" : guardReason ? "BLOCKED" : "PASS",
  memorySamplingStatus,
  cleanupStatus,
  cleanupResult,
  performanceAcceptance: acceptance,
  performanceAcceptanceRule: {
    p95LimitMs: "max(100, 1.5 × idle p95)",
    minimumSamples: 30,
    minimumSamplesState: "BLOCKED, not a changed latency limit",
  },
  scope: "Real HTTP routers, JWT role gates, isolated fresh PostgreSQL and separate real object storage. Synthetic data only; not a browser workload or production edge.",
  targetUploadCount,
  uploadBatchSizes: [1, 10, 20, 50],
  uploadRepetitions: mixedUploadRepetitions,
  clientEventLoop: clients?.clientEventLoop ?? null,
  completedUploadsObserved: requests.filter(row => row.operation === "upload" && row.status > 0).length,
  successfulUploads: requests.filter(row => row.operation === "upload" && row.status >= 200 && row.status < 300).length,
  rssOmissionCount,
  processDiscoveryOmissionCount: discoveryOmissionCount,
  rssOmissionReasons,
  rssOmissionStates,
  memorySamples: {
    peakRss, apiPeakRss, workerTreePeakRss, peakPss, apiPeakPss, workerTreePeakPss,
    pssSampleCount, pssOmissionCount, rssOmissionCount,
    processDiscoveryOmissionCount: discoveryOmissionCount,
    rssOmissionReasons, rssOmissionStates, memoryTimeline,
  },
  setupFailure: clients?.setupFailure ?? null, requests, started: clients?.started, result, summary,
});
console.log(JSON.stringify({
  status, guardReason, rssOmissionCount, processDiscoveryOmissionCount: discoveryOmissionCount,
  rssOmissionReasons, rssOmissionStates, peakRss,
  completedUploadsObserved: requests.filter(row => row.operation === "upload" && row.status > 0).length, summary,
}, null, 2));
if (!latest) throw new Error("Isolated API exited before producing measurements; see mixed-baseline.json");
