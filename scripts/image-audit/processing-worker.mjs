import { readFile } from "node:fs/promises";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { sharp, loadSource, output } from "./common.mjs";

const count = Number(process.argv[2]);
const source = await readFile(path.join(output, "fixtures/detail.jpg"));
let transforms = 0;
// Count actual Sharp encodes in the unchanged production variant processor.
const measuredSharp = (...args) => {
  const pipeline = sharp(...args);
  const encode = pipeline.toBuffer.bind(pipeline);
  pipeline.toBuffer = (...args) => { transforms++; return encode(...args); };
  return pipeline;
};
const policy = await loadSource("lib/api-zod/src/report-image-share.ts");
const { createReportImageVariants } = await loadSource(
  "artifacts/api-server/src/lib/reportImageVariants.ts",
  { sharp: measuredSharp, "@workspace/api-zod": policy },
);
const variants = createReportImageVariants();
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
const samples = [];
const sampler = setInterval(() => {
  const memory = process.memoryUsage();
  samples.push({ atMs: performance.now(), rss: memory.rss, heap: memory.heapUsed, external: memory.external });
}, 25);
await new Promise(resolve => setTimeout(resolve, 30));
const cpu = process.cpuUsage();
const start = performance.now();
const rows = [];
// Matches the current editor's unlimited Promise.all and files.ts's full-size
// JPEG quality 80 followed by print + thumbnail. No storage/DB is simulated
// as being measured. Their timings must come from separate experiments.
await Promise.all(Array.from({ length: count }, async (_, index) => {
  const at = performance.now();
  const uploadEncoded = await sharp(source, { limitInputPixels: 40_000_000 }).rotate()
    .jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const compressedAt = performance.now();
  const diagnostic = [];
  try {
    const photo = await variants(`cold-${index}`, "report-photo", async () => uploadEncoded, row => diagnostic.push(row));
    const photoAt = performance.now();
    const thumbnail = await variants(`cold-${index}`, "report-thumbnail", async () => uploadEncoded);
    rows.push({
      index, status: "PASS", originalBytes: source.length, storedSourceBytes: uploadEncoded.length,
      printBytes: photo.buffer.length, thumbnailBytes: thumbnail.buffer.length,
      uploadEncodeMs: compressedAt - at, printMs: photoAt - compressedAt,
      totalMs: performance.now() - at, diagnostic,
    });
  } catch {
    // The real caller catches variant failures and still acknowledges upload.
    rows.push({ index, status: "FAIL", reason: "derivative_rejected", uploadEncodeMs: compressedAt - at });
  }
}));
const elapsedMs = performance.now() - start;
const cpuUsage = process.cpuUsage(cpu);
await new Promise(resolve => setTimeout(resolve, 25));
clearInterval(sampler);
histogram.disable();
process.send?.({
  kind: "result", count, elapsedMs, cpuUsage, variantEncodes: transforms, samples, rows,
  eventLoop: { p50Ms: histogram.percentile(50) / 1e6, p95Ms: histogram.percentile(95) / 1e6, maxMs: histogram.max / 1e6 },
  finalStatus: variants.getStatus(),
});
