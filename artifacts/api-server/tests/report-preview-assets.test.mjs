import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/report-preview-assets.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  require,
  module,
  module.exports,
);
const { reportUploadFilenames, authorizedReportImageFilenames, mapWithConcurrency } = module.exports;

test("only relative upload URLs are eligible for report signing", () => {
  assert.deepEqual(reportUploadFilenames([
    "/api/uploads/report-share-1-compressed.jpg",
    "/api/uploads/report-share-1-compressed.jpg?variant=report-photo",
    "https://other.example/api/uploads/report-share-2.jpg",
    "//other.example/api/uploads/report-share-3.jpg",
    "/api/uploads/%2e%2e%2fprivate.jpg",
    "/api/uploads/name%5Cother.jpg",
    "data:image/png;base64,AAAA",
  ]), ["report-share-1-compressed.jpg"]);
});

test("only uniquely owned image files from the report project are eligible", () => {
  const referenced = [
    "image.jpg",
    "other-project.jpg",
    "document.pdf",
    "duplicate.jpg",
    "attendance.jpg",
  ];
  const files = [
    { filename: "image.jpg", projectId: 1, category: "image" },
    { filename: "other-project.jpg", projectId: 2, category: "image" },
    { filename: "document.pdf", projectId: 1, category: "pdf" },
    { filename: "duplicate.jpg", projectId: 1, category: "image" },
    { filename: "duplicate.jpg", projectId: 1, category: "image" },
    { filename: "attendance.jpg", projectId: 1, category: "image" },
  ];
  assert.deepEqual(
    authorizedReportImageFilenames(referenced, files, ["attendance.jpg"], 1),
    ["image.jpg"],
  );
});

test("signed URL creation can be bounded to avoid a burst to the storage signer", async () => {
  let active = 0;
  let peak = 0;
  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async value => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});
