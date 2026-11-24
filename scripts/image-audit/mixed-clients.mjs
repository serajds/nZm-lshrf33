import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { output, sharp } from "./common.mjs";

export const mixedUploadRepetitions = Object.freeze({ 1: 30, 10: 4, 20: 3, 50: 1 });

/** Run clients outside the measured API process so its RSS/CPU are not mixed. */
export async function runMixedClients({ origin, projectIds, reportIds, tokens }, signal) {
  const base = index => `${origin}/api/projects/${projectIds[index]}`;
  const source = await readFile(path.join(output, "fixtures/detail.jpg"));
  const preparedSource = await sharp(source).rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 55, mozjpeg: true }).toBuffer();
  assert.ok(preparedSource.length >= 150 * 1024 && preparedSource.length <= 350 * 1024,
    `prepared report source outside target: ${preparedSource.length}`);
  const selfie = (await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#526e82" },
  }).jpeg().toBuffer()).toString("base64");
  const clientEventLoop = monitorEventLoopDelay({ resolution: 10 });
  clientEventLoop.enable();
  const clientEventLoopSummary = () => ({
    p95Ms: clientEventLoop.percentile(95) / 1e6,
    maxMs: clientEventLoop.max / 1e6,
  });
  let phase = "warmup", attendanceType = "check-in";
  const requests = [], started = [];
  let requestSequence = 0;
  async function request(operation, index, suffix, options = {}) {
    const { auditItemIndex, auditBatchSize, ...fetchOptions } = options;
    const at = performance.now(), thisPhase = phase;
    const auditRequestId = `${thisPhase}:${operation}:${++requestSequence}`;
    if (thisPhase !== "warmup") started.push({ operation, phase: thisPhase });
    try {
      const response = await fetch(suffix.startsWith("/api/") ? origin + suffix : base(index) + suffix, {
        ...fetchOptions,
        headers: {
          Authorization: `Bearer ${tokens[index]}`,
          "X-Image-Audit-Operation": operation, "X-Image-Audit-Phase": thisPhase,
          "X-Image-Audit-Request-ID": auditRequestId,
          ...fetchOptions.headers,
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (operation === "export" && response.ok) assert.equal(body.subarray(0, 5).toString(), "%PDF-");
      if (thisPhase !== "warmup") requests.push({
        requestId: auditRequestId, operation, phase: thisPhase, status: response.status,
        bytes: body.length, elapsedMs: performance.now() - at,
        ...(Number.isSafeInteger(auditItemIndex) ? { itemIndex: auditItemIndex } : {}),
        ...(Number.isSafeInteger(auditBatchSize) ? { batchSize: auditBatchSize } : {}),
      });
      return response.status;
    } catch {
      if (thisPhase !== "warmup") requests.push({
        requestId: auditRequestId, operation, phase: thisPhase, status: 0,
        abortedByGuard: signal.aborted, elapsedMs: performance.now() - at,
        ...(Number.isSafeInteger(auditItemIndex) ? { itemIndex: auditItemIndex } : {}),
        ...(Number.isSafeInteger(auditBatchSize) ? { batchSize: auditBatchSize } : {}),
      });
      return 0;
    }
  }
  const operations = [
    () => request("report", 1, `/reports/${reportIds[1]}`),
    () => request("project-edit", 2, "", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Synthetic image load" }),
    }),
    async () => {
      const action = attendanceType;
      const result = await request("attendance-write", 3, `/api/attendance/projects/${projectIds[3]}/${action}`, {
        method: "POST", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ latitude: 0, longitude: 0, selfieBase64: selfie, clientId: randomUUID() }),
      });
      if (result === 201 || result === 200) attendanceType = action === "check-in" ? "check-out" : "check-in";
      return result;
    },
    () => request("files", 4, "/files?page=1&pageSize=24"),
    () => request("export", 5, `/reports/export-pdf?reportId=${reportIds[5]}`),
  ];
  const warmupStatuses = await Promise.all(operations.map(operation => operation()));
  if (warmupStatuses.some(status => status < 200 || status >= 300)) {
    clientEventLoop.disable();
    return {
      requests, started, setupFailure: { reason: "warmup_route_failed", statuses: warmupStatuses },
      clientEventLoop: clientEventLoopSummary(),
    };
  }
  phase = "idle";
  for (let sample = 0; sample < 30 && !signal.aborted; sample++) await Promise.all(operations.map(operation => operation()));
  let finished = false;
  const peers = operations.map(async operation => {
    while (!finished && !signal.aborted) {
      await operation();
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  });
  const measuredOperations = ["report", "project-edit", "attendance-write", "files", "export"];
  async function waitForPhaseSampleFloor(phaseName) {
    const deadline = performance.now() + 8_000;
    while (!signal.aborted && performance.now() < deadline) {
      const counts = new Map();
      for (const row of requests) {
        if (row.phase === phaseName && row.status > 0) {
          counts.set(row.operation, (counts.get(row.operation) ?? 0) + 1);
        }
      }
      if (measuredOperations.every(operation => (counts.get(operation) ?? 0) >= 30)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  for (const [batchSize, repeatCount] of Object.entries(mixedUploadRepetitions)) {
    const batchCount = Number(batchSize);
    for (let repetition = 0; repetition < repeatCount; repetition++) {
      phase = `upload-${batchSize}`;
      let nextUpload = 0;
      const uploadWorker = async () => {
        while (!signal.aborted) {
          const index = nextUpload++;
          if (index >= batchCount) return;
          let attempt = 0, status = 429;
          const packet = {
            mode: "prepared", clientKey: randomUUID(),
            fileName: `synthetic-${batchCount}-${repetition}-${index}.jpg`,
            mimeType: "image/jpeg", encoding: "jpeg", base64: preparedSource.toString("base64"),
          };
          while ([0, 408, 429, 500, 502, 503, 504].includes(status) && attempt < 4 && !signal.aborted) {
            status = await request("upload", 0, "/reports/uploads", {
              method: "POST", body: JSON.stringify(packet),
              headers: { "Content-Type": "text/plain" },
              auditItemIndex: repetition * batchCount + index, auditBatchSize: batchCount,
            });
            if ([0, 408, 429, 500, 502, 503, 504].includes(status)) {
              await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
              attempt += 1;
            }
          }
        }
      };
      await Promise.all([uploadWorker(), uploadWorker()]);
    }
    // Keep the same concurrent peers active until each operation has enough
    // samples for the fixed p95 acceptance rule. This avoids false BLOCKED
    // results when a short upload stage ends before slower routes reach 30.
    await waitForPhaseSampleFloor(`upload-${batchSize}`);
  }
  finished = true;
  await Promise.all(peers);
  clientEventLoop.disable();
  return { requests, started, clientEventLoop: clientEventLoopSummary() };
}
