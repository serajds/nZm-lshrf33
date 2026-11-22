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
} = module.exports;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("report preview copies are generated once locally and deleted with their original", async () => {
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "report-preview-"));
  const originalFilename = "upload-123-compressed.jpg";
  const source = await sharp({
    create: { width: 2600, height: 1800, channels: 3, background: "#447788" },
  }).jpeg({ quality: 95 }).toBuffer();
  const originalPath = path.join(uploadsDir, originalFilename);

  try {
    await writeFile(originalPath, source);
    await createAndStoreReportImageVariant(originalFilename, "report-photo", uploadsDir);

    const saved = await findStoredReportImageVariant(originalFilename, "report-photo", uploadsDir);
    assert.ok(saved);
    assert.equal(saved.contentType, "image/jpeg");
    const previewBytes = await streamToBuffer(saved.stream);
    const metadata = await sharp(previewBytes).metadata();
    assert.equal(metadata.width, 1600);
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

test("small WebP photos keep their supported format in the stored preview copy", async () => {
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
    assert.equal(saved.contentType, "image/webp");
    assert.deepEqual(await streamToBuffer(saved.stream), source);
  } finally {
    await rm(uploadsDir, { recursive: true, force: true });
  }
});
