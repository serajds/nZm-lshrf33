import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { requireApi, fixtures, output, save, distribution } from "./common.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Development benchmark only");
const express = requireApi("express");
const multer = requireApi("multer");
const manifest = await fixtures();
const temporary = path.join(output, "transport-temp");
await mkdir(temporary, { recursive: true });
const app = express();
const histogram = monitorEventLoopDelay({ resolution: 10 });
const requestMetrics = new WeakMap();
app.use((req, _res, next) => {
  requestMetrics.set(req, { at: performance.now(), cpu: process.cpuUsage(), memory: process.memoryUsage() });
  next();
});
const hash = buffer => createHash("sha256").update(buffer).digest("hex");
const receive = mode => async (req, res) => {
  const parsedAt = performance.now();
  const entry = requestMetrics.get(req);
  let bytes;
  try {
    bytes = mode === "base64" ? Buffer.from(JSON.parse(req.body).imageBase64, "base64")
      : mode === "binary" ? req.body : await readFile(req.file.path);
    const decodedAt = performance.now();
    // Same integrity check in all three arms. No Sharp/storage/DB work.
    const digest = hash(bytes);
    const cpu = process.cpuUsage(entry.cpu);
    res.json({
      mode, bytes: bytes.length, digest, parseMs: parsedAt - entry.at,
      decodeMs: decodedAt - parsedAt, totalServerMs: performance.now() - entry.at,
      cpu, rssDelta: process.memoryUsage().rss - entry.memory.rss,
    });
  } finally {
    if (req.file) await rm(req.file.path, { force: true });
  }
};
app.post("/base64", express.text({ type: "text/plain", limit: "32mb" }), receive("base64"));
app.post("/binary", express.raw({ type: "application/octet-stream", limit: "24mb" }), receive("binary"));
app.post("/multipart", multer({ dest: temporary, limits: { fileSize: 24 * 1024 * 1024 } }).single("file"), receive("multipart"));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const rows = [];
histogram.enable();
try {
  for (const fixture of manifest) {
    const bytes = await readFile(path.join(output, "fixtures", fixture.name));
    for (let iteration = 0; iteration < 9; iteration++) {
      // Rotate ordering to reduce warm-up/order bias. First cycle is warm-up.
      const modes = ["base64", "binary", "multipart"];
      for (const mode of [...modes.slice(iteration % 3), ...modes.slice(0, iteration % 3)]) {
        const preparedAt = performance.now();
        let body, contentType;
        if (mode === "base64") {
          body = JSON.stringify({ imageBase64: bytes.toString("base64") }); contentType = "text/plain";
        } else if (mode === "binary") {
          body = bytes; contentType = "application/octet-stream";
        } else {
          const boundary = "image-audit-fixed-boundary";
          body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
            bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
          ]);
          contentType = `multipart/form-data; boundary=${boundary}`;
        }
        const prepareMs = performance.now() - preparedAt;
        const at = performance.now();
        const response = await fetch(`${origin}/${mode}`, {
          method: "POST", headers: { "Content-Type": contentType }, body, signal: AbortSignal.timeout(30_000),
        });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.digest, hash(bytes));
        assert.equal(result.bytes, bytes.length);
        rows.push({
          fixture: fixture.name, iteration, warmup: iteration === 0,
          prepareMs, roundTripMs: performance.now() - at,
          wireBodyBytes: Buffer.byteLength(body), ...result,
        });
      }
    }
  }
} finally {
  histogram.disable();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
const summary = manifest.flatMap(fixture => ["base64", "binary", "multipart"].map(mode => {
  const group = rows.filter(row => row.fixture === fixture.name && row.mode === mode && !row.warmup);
  return {
    fixture: fixture.name, mode,
    roundTripMs: distribution(group.map(row => row.roundTripMs)),
    parseMs: distribution(group.map(row => row.parseMs)),
    decodeMs: distribution(group.map(row => row.decodeMs)),
    prepareMs: distribution(group.map(row => row.prepareMs)),
    wireBodyBytes: group[0].wireBodyBytes,
  };
}));
await save("transport-baseline.json", {
  recordedAt: new Date().toISOString(), node: process.version, rows, summary,
  eventLoop: { p95Ms: histogram.percentile(95) / 1e6, maxMs: histogram.max / 1e6 },
  scope: "Loopback HTTP microbenchmark, same bytes, parser limits, integrity checks and alternating order. No auth/edge/PWA/CORS conclusions.",
  directStorage: { status: "BLOCKED", reason: "Not measured here; requires independently verified isolated development storage, browser CORS and signed completion checks." },
});
console.log(JSON.stringify(summary, null, 2));
