import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const sharp = require("sharp");
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/image-compression-core.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["sharp"],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const { compressImageBuffer, ImageCompressionError } = module.exports;

function noisyPixels(width, height) {
  const data = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed >>> 24;
  }
  return data;
}

test("project photos are resized without exceeding the profile edge", async () => {
  const original = await sharp({
    create: { width: 2400, height: 1200, channels: 3, background: "#156d7a" },
  }).jpeg({ quality: 95 }).toBuffer();
  const result = await compressImageBuffer(original, ["project_file"], "site.jpg");

  assert.equal(result.status, "compressed");
  assert.ok(result.outputBytes < original.length);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(Math.max(metadata.width, metadata.height) <= 1600);
});

test("attendance selfies use the smaller profile", async () => {
  const original = await sharp({
    create: { width: 1500, height: 1000, channels: 3, background: "#c27448" },
  }).jpeg({ quality: 95 }).toBuffer();
  const result = await compressImageBuffer(original, ["attendance_selfie"], "selfie.jpg");

  assert.equal(result.status, "compressed");
  const metadata = await sharp(result.buffer).metadata();
  assert.ok(Math.max(metadata.width, metadata.height) <= 800);
});

test("transparent PNG logos retain PNG and alpha", async () => {
  const original = await sharp({
    create: { width: 1800, height: 1200, channels: 4, background: { r: 20, g: 100, b: 150, alpha: 0.5 } },
  }).png().toBuffer();
  const result = await compressImageBuffer(original, ["company_logo"], "logo.png");

  assert.equal(result.status, "compressed");
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.hasAlpha, true);
  assert.ok(Math.max(metadata.width, metadata.height) <= 1000);
});

test("TIFF and AVIF images stay in their supported file formats", async () => {
  const width = 800;
  const height = 600;
  const data = noisyPixels(width, height);
  const tiff = await sharp(data, { raw: { width, height, channels: 3 } }).tiff().toBuffer();
  const tiffResult = await compressImageBuffer(tiff, ["project_file"], "photo.tiff");
  assert.equal(tiffResult.status, "compressed");
  assert.equal((await sharp(tiffResult.buffer).metadata()).format, "tiff");

  const avif = await sharp(data, { raw: { width, height, channels: 3 } }).avif({ quality: 100 }).toBuffer();
  const avifResult = await compressImageBuffer(avif, ["project_file"], "photo.avif");
  assert.equal(avifResult.status, "compressed");
  assert.equal(avifResult.contentType, "image/avif");
  assert.ok(Math.max(
    (await sharp(avifResult.buffer).metadata()).width,
    (await sharp(avifResult.buffer).metadata()).height,
  ) <= 1600);
});

test("legacy HEIC and HEIF objects are converted to JPEG without changing their keys", async () => {
  const width = 800;
  const height = 600;
  const data = noisyPixels(width, height);
  const heif = await sharp(data, { raw: { width, height, channels: 3 } })
    .heif({ compression: "av1", quality: 100 }).toBuffer();
  const result = await compressImageBuffer(heif, ["report_photo"], "report-share-legacy.heic");
  assert.equal(result.status, "compressed");
  assert.equal(result.contentType, "image/jpeg");
  assert.equal((await sharp(result.buffer).metadata()).format, "jpeg");
});

test("already compact images and unsupported vector images are not rewritten", async () => {
  const small = await sharp({
    create: { width: 80, height: 80, channels: 3, background: "#226644" },
  }).jpeg({ quality: 80 }).toBuffer();
  const compact = await compressImageBuffer(small, ["project_file"], "small.jpg");
  assert.equal(compact.status, "skipped");
  assert.equal(compact.reason, "already_compact");

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');
  const vector = await compressImageBuffer(svg, ["company_logo"], "logo.svg");
  assert.equal(vector.status, "skipped");
  assert.equal(vector.reason, "unsupported_format");
});

test("invalid image bytes fail explicitly instead of being replaced", async () => {
  await assert.rejects(
    compressImageBuffer(Buffer.from("not an image"), ["project_file"], "bad.jpg"),
    error => error instanceof ImageCompressionError && error.code === "unreadable_image",
  );
});
