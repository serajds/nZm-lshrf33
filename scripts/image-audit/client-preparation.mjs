import assert from "node:assert/strict";
import { openAuditBrowser } from "./cdp.mjs";

const origin = process.env.IMAGE_AUDIT_WEB_ORIGIN ?? "http://127.0.0.1:22349/login";
console.error("browser-fixture:opening");
const browser = await openAuditBrowser(origin);
try {
  console.error("browser-fixture:preparing");
  const result = await browser.evaluate(`(async () => {
    const module = await import("/src/lib/prepare-report-image.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 3200; canvas.height = 2400;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#35485c"; context.lineWidth = 2;
    for (let x = 0; x < canvas.width; x += 8) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke(); }
    for (let y = 0; y < canvas.height; y += 8) { context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    const source = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.94));
    const file = new File([source], "synthetic-engineering-detail.jpg", { type: "image/jpeg" });
    const longTasks = [];
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: "longtask", buffered: false });
    const start = performance.now();
    const prepared = await module.prepareReportImage(file, new AbortController().signal);
    const elapsedMs = performance.now() - start;
    const base64 = await module.blobToCanonicalBase64(prepared.blob, new AbortController().signal);
    observer.disconnect();
    const decodedBytes = atob(base64).length;
    return {
      status: "PASS", sourceBytes: file.size, outputBytes: prepared.blob.size,
      sourceWidth: canvas.width, sourceHeight: canvas.height,
      outputType: prepared.blob.type, width: prepared.width, height: prepared.height,
      elapsedMs, largestMainThreadTaskMs: Math.max(0, ...longTasks),
      canonicalBase64: /^[A-Za-z0-9+/]+={0,2}$/.test(base64) && base64.length % 4 === 0,
      decodedBytes,
    };
  })()`, { timeoutMs: 60_000 });
  assert.equal(result.status, "PASS");
  assert.ok(Math.max(result.width, result.height) <= 1600);
  assert.equal(result.outputType, "image/webp");
  assert.ok(result.outputBytes > 0 && result.outputBytes <= 2 * 1024 * 1024);
  assert.equal(result.canonicalBase64, true);
  assert.equal(result.decodedBytes, result.outputBytes);
  console.error("browser-fixture:cancel");
  const workerCancellation = await browser.evaluate(`(async () => {
    const module = await import("/src/lib/prepare-report-image.ts");
    const source = new File([new Uint8Array(4000)], "cancel.jpg", { type: "image/jpeg" });
    const controller = new AbortController();
    const task = module.prepareReportImage(source, controller.signal)
      .then(() => "unexpected_success", error => error.name);
    controller.abort();
    return await task;
  })()`, { timeoutMs: 10_000 });
  assert.equal(workerCancellation, "AbortError");
  console.error("browser-fixture:queue");
  const queue = await browser.evaluate(`(async () => {
    const { createReportImageUploadQueue } = await import("/src/lib/report-image-upload-queue.ts");
    const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 700;
    const context = canvas.getContext("2d"); context.fillStyle = "#fff"; context.fillRect(0, 0, 1000, 700);
    context.strokeStyle = "#345"; for (let x = 0; x < 1000; x += 12) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 700); context.stroke(); }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    const jobs = [], completions = [], attempts = new Map();
    let active = 0, peak = 0, failOnce = true, cancelled = 0, cancelId = "";
    const NativeXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = class {
      upload = {};
      status = 0; statusText = ""; responseText = ""; timeout = 0;
      open() {} setRequestHeader() {} getResponseHeader() { return null; }
      send(body) {
        const packet = JSON.parse(body), count = (attempts.get(packet.clientKey) ?? 0) + 1;
        attempts.set(packet.clientKey, count);
        active++; this.pending = true; peak = Math.max(peak, active);
        if (packet.fileName === "cancel.jpg") return;
        this.timer = setTimeout(() => {
          if (this.pending) { active--; this.pending = false; }
          if (failOnce) { failOnce = false; this.onerror?.(); return; }
          this.status = 201;
          this.responseText = JSON.stringify({ fileUrl: "/api/uploads/test-" + packet.clientKey });
          this.onload?.();
        }, count === 1 ? 35 : 10);
      }
      abort() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.pending) { active = Math.max(0, active - 1); this.pending = false; }
        cancelled++; this.onabort?.();
      }
    };
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      if (String(input).includes("/reports/uploads/status?")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      return nativeFetch(input, init);
    };
    const queue = createReportImageUploadQueue({
      projectId: 7,
      onChange: job => { if (job) { jobs.push(job.status); if (job.fileName === "cancel.jpg" && job.status === "uploading") cancelId = job.id; } },
      onSuccess: (job, url) => completions.push({ order: job.order, url }),
    });
    const batches = Array.from({ length: 5 }, (_, index) =>
      queue.add(new File([blob], "queue-" + index + ".jpg", { type: "image/jpeg" }), index < 3 ? "group-a" : "group-b", index + 1));
    await Promise.all(batches.map(item => item.promise));
    const failedRetryRecovered = completions.length === 5 && Math.max(...attempts.values()) === 2;
    const stableSelectionOrder = completions.map(item => item.order).sort((a,b) => a-b).join(",") === "1,2,3,4,5";
    const cancelPromise = queue.add(new File([blob], "cancel.jpg", { type: "image/jpeg" }), "group-c", 6);
    for (let n = 0; n < 100 && !cancelId; n++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    if (cancelId) queue.cancel(cancelId);
    await cancelPromise.promise;
    queue.dispose(); window.XMLHttpRequest = NativeXHR; window.fetch = nativeFetch;
    return {
      queuedJobs: completions.length, peakConcurrentRequests: peak,
      retryAttemptMaximum: Math.max(...attempts.values()), failedRetryRecovered,
      stableSelectionOrder, retryVisible: jobs.includes("retrying"),
      cancelledUploadSettled: !!cancelId && cancelled === 1,
    };
  })()`, { timeoutMs: 60_000 });
  assert.equal(queue.peakConcurrentRequests, 2);
  assert.equal(queue.queuedJobs, 5);
  assert.equal(queue.failedRetryRecovered, true);
  assert.equal(queue.stableSelectionOrder, true);
  assert.equal(queue.retryVisible, true);
  assert.equal(queue.cancelledUploadSettled, true);
  const summary = {
    clientPreparation: result, workerCancellation, queue,
    fixture: "synthetic 3200x2400 dense grid",
    note: "Preparation used a real browser worker. Queue upload transport used a controlled browser mock; server, auth, and durable-storage checks are recorded separately.",
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} finally {
  await browser.close();
}
