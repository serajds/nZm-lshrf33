import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { validateReportPdfImage } from "../artifacts/api-server/src/lib/report-pdf-image-validation.ts";

function createImageReader({ validMetadata = true } = {}) {
  const calls = { metadata: 0, stats: 0 };
  const reader = () => ({
    metadata: async () => {
      calls.metadata++;
      return validMetadata
        ? { width: 1200, height: 800, format: "jpeg" }
        : { width: 0, height: 800, format: "jpeg" };
    },
    stats: async () => { calls.stats++; return {}; },
  });
  return { reader, calls };
}

test("PDF image validation reuses only successful results for the same file fingerprint", async () => {
  const { reader, calls } = createImageReader();
  const filePath = `/synthetic/${randomUUID()}.jpg`;
  const first = await validateReportPdfImage(filePath, false, reader, "v1");
  const repeated = await validateReportPdfImage(filePath, false, reader, "v1");

  assert.equal(first.pixelValidated, true);
  assert.equal(repeated.pixelValidated, true);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.stats, 1);
  assert.equal(repeated.metadataMs, 0);
  assert.equal(repeated.pixelValidationMs, 0);
});

test("replaced or modified files receive a fresh PDF image validation", async () => {
  const { reader, calls } = createImageReader();
  const filePath = `/synthetic/${randomUUID()}.jpg`;
  await validateReportPdfImage(filePath, false, reader, "inode:mtime-1");
  await validateReportPdfImage(filePath, false, reader, "inode:mtime-2");

  assert.equal(calls.metadata, 2);
  assert.equal(calls.stats, 2);
});

test("managed images keep metadata-only validation and never run full pixel stats", async () => {
  const { reader, calls } = createImageReader();
  const filePath = `/synthetic/${randomUUID()}.jpg`;
  const result = await validateReportPdfImage(filePath, true, reader, "managed-v1");

  assert.equal(result.pixelValidated, false);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.stats, 0);
});

test("invalid legacy images are not cached as successfully validated", async () => {
  const { reader, calls } = createImageReader({ validMetadata: false });
  const filePath = `/synthetic/${randomUUID()}.jpg`;

  await assert.rejects(validateReportPdfImage(filePath, false, reader, "bad-v1"), /invalid_pdf_image_metadata/);
  await assert.rejects(validateReportPdfImage(filePath, false, reader, "bad-v1"), /invalid_pdf_image_metadata/);
  assert.equal(calls.metadata, 2);
});
