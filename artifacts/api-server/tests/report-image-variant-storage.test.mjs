import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const {
  deleteStoredReportImageVariants,
  findStoredReportImageVariant,
  getStoredReportImageVariantMetadata,
  reportPrintImageObjectName,
} = module.exports;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("legacy print keys remain addressable without exposing source filenames", () => {
  const first = reportPrintImageObjectName("old-report-photo.jpg");
  const second = reportPrintImageObjectName("another-old-photo.jpg");
  assert.match(first, /^report-print-v3\/development\/[a-f0-9]{64}\.jpg$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /old-report-photo/);
});

test("legacy derivatives can be read and are cleaned only with their owning old image", async () => {
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "legacy-report-variants-"));
  const originalFilename = "old-report-photo.jpg";
  const source = Buffer.from("synthetic historical source");
  const derivative = Buffer.from("synthetic historical derivative");
  const photo = `report-preview-v3-report-photo-${originalFilename}.jpg`;
  const thumbnail = `report-preview-v3-report-thumbnail-${originalFilename}.jpg`;
  try {
    await writeFile(path.join(uploadsDir, originalFilename), source);
    await writeFile(path.join(uploadsDir, photo), derivative);
    await writeFile(path.join(uploadsDir, thumbnail), derivative);
    const saved = await findStoredReportImageVariant(originalFilename, "report-photo", uploadsDir);
    const metadata = await getStoredReportImageVariantMetadata(originalFilename, "report-photo", uploadsDir);
    const thumb = await findStoredReportImageVariant(originalFilename, "report-thumbnail", uploadsDir);
    assert.ok(saved);
    assert.ok(thumb);
    assert.equal(saved.contentType, "image/jpeg");
    assert.deepEqual(metadata, { size: derivative.length, contentType: "image/jpeg" });
    assert.equal(thumb.contentType, "image/jpeg");
    assert.deepEqual(await streamToBuffer(saved.stream), derivative);
    assert.deepEqual(await streamToBuffer(thumb.stream), derivative);
    assert.equal(module.exports.createAndStoreReportImageVariant, undefined);
    assert.equal(module.exports.storeReportImageVariant, undefined);
    await deleteStoredReportImageVariants(originalFilename, uploadsDir);
    assert.deepEqual(await readdir(uploadsDir), [originalFilename]);
    assert.deepEqual(await readFile(path.join(uploadsDir, originalFilename)), source);
  } finally {
    await rm(uploadsDir, { recursive: true, force: true });
  }
});
