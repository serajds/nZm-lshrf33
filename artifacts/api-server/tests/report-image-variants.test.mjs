import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const require = createRequire(new URL("../package.json", import.meta.url));
const sharp = require("sharp");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/reportImageVariants.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const { createReportImageVariants, shouldServeOriginalCompressedSharePhoto } = module.exports;

test("large photos are smaller, bounded for printing, and originals are untouched", async () => {
  const source = await sharp({ create: { width: 3600, height: 2400, channels: 3, background: "#bb845d" } })
    .jpeg({ quality: 100 }).toBuffer();
  const original = Buffer.from(source);
  const variant = await createReportImageVariants()("photo", "report-photo", async () => source);
  const metadata = await sharp(variant.buffer).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 1067);
  assert.equal(variant.contentType, "image/jpeg");
  assert.ok(variant.buffer.length < source.length);
  assert.deepEqual(source, original);
  console.log(`Synthetic photo: ${source.length} -> ${variant.buffer.length} bytes (${(100 * (1 - variant.buffer.length/source.length)).toFixed(1)}% smaller)`);
});

test("transparent logos retain transparency and readable resolution", async () => {
  const source = await sharp({ create: { width: 1800, height: 900, channels: 4, background: { r: 40, g: 80, b: 100, alpha: 0.4 } } })
    .png().toBuffer();
  const result = await createReportImageVariants()("logo", "report-logo", async () => source);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(result.contentType, "image/png");
});

test("small images aren't enlarged or made heavier", async () => {
  const source = await sharp({ create: { width: 120, height: 60, channels: 3, background: "white" } }).jpeg().toBuffer();
  const result = await createReportImageVariants()("small", "report-photo", async () => source);
  assert.ok(result.buffer.length <= source.length);
  assert.equal((await sharp(result.buffer).metadata()).width, 120);
});

test("reuse is versioned, coalesced and distinct for photos and logos", async () => {
  const get = createReportImageVariants();
  const source = await sharp({ create: { width: 80, height: 80, channels: 3, background: "blue" } }).png().toBuffer();
  let reads = 0;
  const read = async () => { reads++; return source; };
  await Promise.all([get("file:v1", "report-photo", read), get("file:v1", "report-photo", read)]);
  await get("file:v1", "report-photo", read);
  assert.equal(reads, 1);
  await get("file:v2", "report-photo", read);
  await get("file:v1", "report-logo", read);
  assert.equal(reads, 3);
});

test("reports cache state, source dimensions and active processor counts", async () => {
  const get = createReportImageVariants();
  const source = await sharp({ create: { width: 240, height: 120, channels: 3, background: "teal" } })
    .jpeg().toBuffer();
  const diagnostics = [];
  const read = async () => source;

  await get("diagnostic-photo", "report-photo", read, item => diagnostics.push(item));
  assert.equal(diagnostics[0].state, "processed");
  assert.equal(diagnostics[0].sourceBytes, source.length);
  assert.equal(diagnostics[0].width, 240);
  assert.equal(diagnostics[0].height, 120);
  assert.equal(diagnostics[0].activeJobs, 1);
  assert.ok(diagnostics[0].metadataMs >= 0);
  assert.ok(diagnostics[0].encodeMs >= 0);

  diagnostics.length = 0;
  await get("diagnostic-photo", "report-photo", read, item => diagnostics.push(item));
  assert.equal(diagnostics[0].state, "memory_hit");
  assert.ok(diagnostics[0].outputBytes > 0);
  assert.equal(get.getStatus().activeJobs, 0);
  assert.equal(get.getStatus().pendingJobs, 0);
});

test("compressed shared photos avoid Sharp in Development and on production cache misses", async () => {
  const filename = "report-share-56f8a6e3-06bc-43f4-a627-e473c5aa6dca-compressed.jpg";
  assert.equal(shouldServeOriginalCompressedSharePhoto("development", filename, "report-photo", true), true);
  assert.equal(shouldServeOriginalCompressedSharePhoto("development", filename, "report-photo", false), true);
  assert.equal(shouldServeOriginalCompressedSharePhoto("production", filename, "report-photo", true), false);
  assert.equal(shouldServeOriginalCompressedSharePhoto("production", filename, "report-photo", false), true);
  assert.equal(shouldServeOriginalCompressedSharePhoto("development", "other.jpg", "report-photo", false), false);
  assert.equal(shouldServeOriginalCompressedSharePhoto("development", filename, "report-logo", false), false);
  const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  const fallback = source.indexOf("if (originalSharePhotoFallback)");
  const sharpTransform = source.indexOf("reportImageVariant(key, variant");
  assert.ok(fallback >= 0 && fallback < sharpTransform);
});

test("corrupt input fails explicitly and does not poison reuse", async () => {
  const get = createReportImageVariants();
  for (let i = 0; i < 2; i++) {
    await assert.rejects(get("bad", "report-photo", async () => Buffer.from("not an image")));
  }
});

test("derivatives remain behind the unchanged authorization gate and no-store", async () => {
  const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("canAccessPrivateUpload(reqPath, token, res)") < source.indexOf('req.query.variant === "report-photo"'));
  assert.match(source.slice(source.indexOf('req.query.variant === "report-photo"')), /Cache-Control", "private, no-store, no-cache, must-revalidate"/);
});
