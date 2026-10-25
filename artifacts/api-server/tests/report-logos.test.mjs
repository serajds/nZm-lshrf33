import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(file) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { prepareReportLogos, reportAssetUrl } = await load("../../construction-supervision/src/lib/report-logos.ts");
const { buildPrintHTML } = await load("../../construction-supervision/src/lib/report-pdf.ts");
const image = "data:image/png;base64,iVBORw0KGgo=";

test("all three protected logos are resolved before printing without mutating company data", async () => {
  const original = Object.fromEntries(["owner", "contractor", "supervisor"].map(role =>
    [role, { name: role, logoUrl: `/api/uploads/${role}.png` }]));
  const calls = [];
  const logos = await prepareReportLogos(original, async url => { calls.push(url); return image; });
  assert.equal(calls.length, 3);
  assert.equal(original.owner.logoUrl, "/api/uploads/owner.png");
  const html = buildPrintHTML({
    projectName: "اختبار الشعارات", reportType: "weekly", reportId: 1,
    reportDate: "2026-10-25", periodStart: "2026-10-19", periodEnd: "2026-10-25",
    progressPercentage: 40, workDescription: "أعمال", companyLogos: logos,
    apiBase: "https://example.test",
  });
  assert.equal(html.split(`src="${image}"`).length - 1, 3);
  assert.doesNotMatch(html, /src="https:\/\/example.testdata:/);
  assert.doesNotMatch(html, /\/api\/uploads\//);
});

test("failed logo requests stop preparation instead of silently dropping a logo", async () => {
  await assert.rejects(prepareReportLogos({ owner: { name: "مالك", logoUrl: "/api/uploads/logo.png" } },
    async () => { throw new Error("HTTP 401"); }), /HTTP 401/);
  await assert.rejects(prepareReportLogos({ owner: { name: "مالك", logoUrl: "/api/uploads/logo.png" } },
    async () => ""), /Unable to load/);
});

test("missing optional logos remain optional; absolute and embedded URLs are not prefixed", async () => {
  assert.deepEqual(await prepareReportLogos({ owner: { name: "مالك", logoUrl: null } },
    async () => { throw new Error("should not fetch"); }), { owner: { name: "مالك", logoUrl: null } });
  assert.equal(reportAssetUrl(image, "/app"), image);
  assert.equal(reportAssetUrl("https://cdn.test/logo.png", "/app"), "https://cdn.test/logo.png");
  assert.equal(reportAssetUrl("/api/uploads/logo.png", "/app/"), "/app/api/uploads/logo.png");
});
