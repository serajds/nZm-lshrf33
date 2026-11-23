import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";
const require = createRequire(new URL("../package.json", import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/reportImageVariantStorage.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const {
  createAndStoreReportImageVariant,
  deleteStoredReportImageVariants,
  findStoredReportImageVariant,
  reportPrintImageObjectName,
} = module.exports;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("print derivatives use separate environment-scoped keys and preserve source naming", () => {
  const original = "report-share-abc-compressed.jpg";
  const first = reportPrintImageObjectName(original);
  const second = reportPrintImageObjectName("report-share-other-compressed.jpg");
  assert.match(first, /^report-print-100kb\/development\/[a-f0-9]{64}\.jpg$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /report-share/);
});

test("report screen thumbnails and print copies are stored and deleted with their original", async () => {
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "report-preview-"));
  const originalFilename = "upload-123-compressed.jpg";
  const source = await sharp({
    create: { width: 2600, height: 1800, channels: 3, background: "#447788" },
  }).jpeg({ quality: 95 }).toBuffer();
  const originalPath = path.join(uploadsDir, originalFilename);

  try {
    await writeFile(originalPath, source);
    await createAndStoreReportImageVariant(originalFilename, "report-photo", uploadsDir);
    await createAndStoreReportImageVariant(originalFilename, "report-thumbnail", uploadsDir);

    const saved = await findStoredReportImageVariant(originalFilename, "report-photo", uploadsDir);
    const thumbnail = await findStoredReportImageVariant(originalFilename, "report-thumbnail", uploadsDir);
    assert.ok(saved);
    assert.ok(thumbnail);
    assert.equal(saved.contentType, "image/jpeg");
    assert.equal(thumbnail.contentType, "image/jpeg");
    const previewBytes = await streamToBuffer(saved.stream);
    const thumbnailBytes = await streamToBuffer(thumbnail.stream);
    const metadata = await sharp(previewBytes).metadata();
    const thumbnailMetadata = await sharp(thumbnailBytes).metadata();
    assert.ok(previewBytes.length <= 100 * 1024);
    if (source.length > 100 * 1024) assert.ok(metadata.width <= 1000);
    else assert.equal(metadata.width, 2600);
    assert.equal(thumbnailMetadata.width, 640);
    assert.deepEqual(await readFile(originalPath), source);

    await deleteStoredReportImageVariants(originalFilename, uploadsDir);
    assert.deepEqual(await readdir(uploadsDir), [originalFilename]);
  } finally {
    await rm(uploadsDir, { recursive: true, force: true });
  }
});

test("transparent company-logo previews are stored as PNG", async () => {
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "report-logo-preview-"));
  const originalFilename = "logo-123.png";
  const source = await sharp({
    create: { width: 1800, height: 900, channels: 4, background: { r: 40, g: 80, b: 100, alpha: 0.4 } },
  }).png().toBuffer();

  try {
    await writeFile(path.join(uploadsDir, originalFilename), source);
    await createAndStoreReportImageVariant(originalFilename, "report-logo", uploadsDir);

    const saved = await findStoredReportImageVariant(originalFilename, "report-logo", uploadsDir);
    assert.ok(saved);
    assert.equal(saved.contentType, "image/png");
    const metadata = await sharp(await streamToBuffer(saved.stream)).metadata();
    assert.equal(metadata.width, 1000);
    assert.equal(metadata.hasAlpha, true);
  } finally {
    await rm(uploadsDir, { recursive: true, force: true });
  }
});

test("small JPEG and WebP company logos can be stored without conversion", async () => {
  for (const [extension, format, contentType] of [
    ["jpg", "jpeg", "image/jpeg"],
    ["webp", "webp", "image/webp"],
  ]) {
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "report-small-logo-"));
    const originalFilename = `logo-small.${extension}`;
    const rawPixels = Buffer.alloc(80 * 40 * 3);
    for (let i = 0; i < rawPixels.length; i++) rawPixels[i] = (i * 73 + (i >> 3) * 19) % 256;
    const source = await sharp(rawPixels, { raw: { width: 80, height: 40, channels: 3 } })
      [format]({ quality: 35 }).toBuffer();

    try {
      await writeFile(path.join(uploadsDir, originalFilename), source);
      await createAndStoreReportImageVariant(originalFilename, "report-logo", uploadsDir);

      const saved = await findStoredReportImageVariant(originalFilename, "report-logo", uploadsDir);
      assert.ok(saved);
      assert.equal(saved.contentType, contentType);
      assert.deepEqual(await streamToBuffer(saved.stream), source);
    } finally {
      await rm(uploadsDir, { recursive: true, force: true });
    }
  }
});

test("WebP photos get a printable JPEG derivative while the original stays unchanged", async () => {
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "report-webp-preview-"));
  const originalFilename = "small-photo.webp";
  const source = await sharp({
    create: { width: 100, height: 60, channels: 3, background: "#447788" },
  }).webp({ quality: 70 }).toBuffer();

  try {
    await writeFile(path.join(uploadsDir, originalFilename), source);
    await createAndStoreReportImageVariant(originalFilename, "report-photo", uploadsDir);

    const saved = await findStoredReportImageVariant(originalFilename, "report-photo", uploadsDir);
    assert.ok(saved);
      assert.equal(saved.contentType, "image/jpeg");
      assert.ok((await streamToBuffer(saved.stream)).length <= 100 * 1024);
      assert.deepEqual(await readFile(path.join(uploadsDir, originalFilename)), source);
  } finally {
    await rm(uploadsDir, { recursive: true, force: true });
  }
});
