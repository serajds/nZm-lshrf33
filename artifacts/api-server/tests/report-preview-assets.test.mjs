import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
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

test("report image links remain report-scoped and use stored variants without read-time processing", async () => {
  const source = await readFile(new URL("../src/routes/reports.ts", import.meta.url), "utf8");
  const start = source.indexOf('"/projects/:projectId/reports/:id/preview-image-links"');
  const end = source.indexOf('"/projects/:projectId/reports/image-optimization"', start);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireProjectAccess\("projectId"\).*requireTabView\("reports"\)/s);
  assert.match(route, /authorizedReportImageFilenames\(/);
  assert.match(route, /assertReportPrintImageBudget\(targets\)/);
  assert.match(route, /getUploadObjectMetadata\(managed\.filename, managed\.bucketId\)/);
  assert.match(route, /reportPrintImageObjectName\(filename\)/);
  assert.match(route, /getStoredReportImageVariantMetadata\(/);
  assert.match(route, /source=original/);
  assert.match(route, /createSignedUploadReadUrl\(filename, 900\)/);
  assert.match(route, /retryable: true/);
  assert.ok(route.indexOf("assertReportPrintImageBudget(targets)") < route.indexOf("target.createUrl()"));
  assert.doesNotMatch(route, /cloudReportImageSource/);
  const previewUrlSource = await readFile(new URL("../../construction-supervision/src/lib/report-logos.ts", import.meta.url), "utf8");
  assert.match(previewUrlSource, /searchParams\.get\("source"\) === "original"/);
  assert.doesNotMatch(route, /NODE_ENV !== "development"/);
  assert.doesNotMatch(route, /sharp\(|reportImageVariant\(|createAndStoreReportImageVariant/);
});

test("legacy report optimization is retired and active history is paused without deleting data", async () => {
  const source = await readFile(new URL("../src/routes/reports.ts", import.meta.url), "utf8");
  const storeSource = await readFile(new URL("../src/lib/report-image-optimization-job-store.ts", import.meta.url), "utf8");
  const start = source.indexOf('"/projects/:projectId/reports/image-optimization"');
  const end = source.indexOf('"/projects/:projectId/reports/image-optimization"', start + 1);
  const route = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireProjectManager\("projectId"\)/);
  assert.match(route, /res\.status\(410\)/);
  assert.match(storeSource, /status: "paused"/);
  assert.match(storeSource, /leaseOwner: null/);
  assert.doesNotMatch(source, /createReportImageOptimizationJobs|reportImageVariant\s*\(/);
  const web = await readFile(new URL("../../construction-supervision/src/pages/projects/[id]/reports.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(web, /image-optimization|تهيئة صور المشروع للطباعة/);
});

test("new report and project-file uploads use the shared lifecycle", async () => {
  const files = await readFile(new URL("../src/routes/files.ts", import.meta.url), "utf8");
  const reports = await readFile(new URL("../src/routes/report-image-uploads.ts", import.meta.url), "utf8");
  assert.match(files, /fileImageLifecycle\.upload\(/);
  assert.match(reports, /lifecycle\.upload\(/);
  assert.doesNotMatch(files + reports, /createAndStoreReportImageVariant|reportImageVariant\s*\(/);
});
