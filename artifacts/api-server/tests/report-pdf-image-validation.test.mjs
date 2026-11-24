import assert from "node:assert/strict";
import test from "node:test";
import { validateReportPdfImage } from "../src/lib/report-pdf-image-validation.ts";

function makeReader({ metadata = { width: 1200, height: 800, format: "jpeg" }, statsError } = {}) {
  const calls = { metadata: 0, stats: 0 };
  const reader = (_path, _options) => ({
    metadata: async () => {
      calls.metadata++;
      return metadata;
    },
    stats: async () => {
      calls.stats++;
      if (statsError) throw statsError;
      return {};
    },
  });
  return { calls, reader };
}

test("managed prepared print images need header validation, not another pixel scan", async () => {
  const { calls, reader } = makeReader();
  const result = await validateReportPdfImage("/tmp/managed-print.jpg", true, reader);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.stats, 0);
  assert.equal(result.pixelValidated, false);
});

test("legacy PDF images keep full preflight pixel validation before document output", async () => {
  const { calls, reader } = makeReader();
  const result = await validateReportPdfImage("/tmp/legacy-image.jpg", false, reader);
  assert.equal(calls.metadata, 1);
  assert.equal(calls.stats, 1);
  assert.equal(result.pixelValidated, true);
});

test("invalid image metadata fails before PDF output", async () => {
  const { calls, reader } = makeReader({
    metadata: { width: 1200, height: 800, format: "webp" },
  });
  await assert.rejects(
    validateReportPdfImage("/tmp/wrong-format.webp", true, reader),
    /invalid_pdf_image_metadata/,
  );
  assert.equal(calls.stats, 0);
});

test("corrupt legacy pixels fail preflight instead of allowing a partial PDF", async () => {
  const { calls, reader } = makeReader({ statsError: new Error("bad pixel data") });
  await assert.rejects(
    validateReportPdfImage("/tmp/corrupt-legacy.jpg", false, reader),
    /bad pixel data/,
  );
  assert.equal(calls.metadata, 1);
  assert.equal(calls.stats, 1);
});
