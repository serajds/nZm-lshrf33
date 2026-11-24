import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-print-image-preflight.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
const {
  assertReportPrintImageBudget,
  reportPrintMimeTypeFromFilename,
  REPORT_PRINT_IMAGE_MAX_BYTES,
  REPORT_PRINT_IMAGES_MAX_TOTAL_BYTES,
} = module.exports;

test("print preflight accepts supported copies only within the per-image and total budgets", () => {
  const images = [
    { filename: "a.jpg", size: 7 * 1024 * 1024, contentType: "image/jpeg" },
    { filename: "b.webp", size: 8 * 1024 * 1024, contentType: "image/webp" },
    { filename: "c.png", size: 5 * 1024 * 1024, contentType: "image/png" },
  ];
  assert.equal(assertReportPrintImageBudget(images), 20 * 1024 * 1024);
  assert.equal(REPORT_PRINT_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(REPORT_PRINT_IMAGES_MAX_TOTAL_BYTES, 32 * 1024 * 1024);
});

test("oversized originals and wrong or unknown image types fail before any link is issued", () => {
  assert.throws(() => assertReportPrintImageBudget([
    { filename: "large.jpg", size: REPORT_PRINT_IMAGE_MAX_BYTES + 1, contentType: "image/jpeg" },
  ]), /report_print_image_unavailable/);
  assert.throws(() => assertReportPrintImageBudget([
    { filename: "unknown.jpg", size: 1024, contentType: null },
  ]), /report_print_image_unavailable/);
  assert.throws(() => assertReportPrintImageBudget([
    { filename: "wrong.svg", size: 1024, contentType: "image/svg+xml" },
  ]), /report_print_image_unavailable/);
});

test("a missing historical derivative can use a small validated original but cannot exceed the total budget", () => {
  const originalFallbacks = Array.from({ length: 5 }, (_, index) => ({
    filename: `old-${index}.jpg`,
    size: 7 * 1024 * 1024,
    contentType: "image/jpeg",
  }));
  assert.throws(() => assertReportPrintImageBudget(originalFallbacks), /report_print_images_total_limit/);
  assert.equal(assertReportPrintImageBudget(originalFallbacks.slice(0, 4)), 28 * 1024 * 1024);
});

test("local historical file types are inferred only for supported browser image formats", () => {
  assert.equal(reportPrintMimeTypeFromFilename("old-photo.JPG"), "image/jpeg");
  assert.equal(reportPrintMimeTypeFromFilename("old-photo.png"), "image/png");
  assert.equal(reportPrintMimeTypeFromFilename("old-photo.webp"), "image/webp");
  assert.equal(reportPrintMimeTypeFromFilename("old-photo.heic"), null);
});
