import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../../construction-supervision/src/lib/report-preview-loader.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { loadReportPreview, openReportPreviewWindow, updateReportPreviewStatus } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("report and logo requests start together; photos do not wait for slow logos", async () => {
  let resolveReport, resolveLogos;
  const started = [];
  const loaded = [];
  const pending = loadReportPreview({
    loadReport: () => { started.push("report"); return new Promise(resolve => { resolveReport = resolve; }); },
    loadLogos: () => { started.push("logos"); return new Promise(resolve => { resolveLogos = resolve; }); },
    loadAsset: async url => { loaded.push(url); return `data:${url}`; },
    onProgress: () => {},
  });
  assert.deepEqual(started, ["report", "logos"]);
  resolveReport({ imageGroups: [{ category: "صور", urls: ["photo"] }], imageUrls: ["photo"] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(loaded, ["photo"]);
  resolveLogos({ owner: { name: "مالك", logoUrl: "logo" } });
  const preview = await pending;
  assert.deepEqual(preview.imageUrls, []);
  assert.deepEqual(preview.imageGroups[0].urls, ["data:photo"]);
  assert.equal(preview.companyLogos.owner.logoUrl, "data:logo");
});

test("duplicate assets load once per preview without retaining a cross-session cache", async () => {
  let count = 0;
  const progress = [];
  const options = {
    loadReport: async () => ({ imageUrls: ["same", "same"] }),
    loadLogos: async () => ({ owner: { name: "مالك", logoUrl: "same" } }),
    loadAsset: async () => { count++; return "data:image"; },
    onProgress: (done, total) => progress.push([done, total]),
  };
  const preview = await loadReportPreview(options);
  assert.equal(count, 1);
  assert.deepEqual(preview.imageUrls, ["data:image", "data:image"]);
  assert.deepEqual(progress.at(-1), [1, 1]);
  await loadReportPreview(options);
  assert.equal(count, 2);
});

test("logos use their lossless variant separately from report photos", async () => {
  const result = await loadReportPreview({
    loadReport: async () => ({ imageUrls: ["same"] }),
    loadLogos: async () => ({ owner: { name: "مالك", logoUrl: "same" } }),
    loadAsset: async () => "blob:photo",
    loadLogoAsset: async () => "blob:lossless-logo",
    onProgress: () => {},
  });
  assert.deepEqual(result.imageUrls, ["blob:photo"]);
  assert.equal(result.companyLogos.owner.logoUrl, "blob:lossless-logo");
});

test("failed photos and logos reject instead of silently issuing an incomplete report", async () => {
  for (const failure of ["photo", "logo"]) {
    await assert.rejects(loadReportPreview({
      loadReport: async () => ({ imageUrls: ["photo"] }),
      loadLogos: async () => ({ owner: { name: "مالك", logoUrl: "logo" } }),
      loadAsset: async url => { if (url === failure) throw new Error("offline"); return "data:image"; },
      onProgress: () => {},
    }), /offline/);
  }
});

test("large reports use at most two downloads and preserve all 61 assets in order", async () => {
  let active = 0;
  let peak = 0;
  const urls = Array.from({ length: 60 }, (_, i) => `photo-${i}`);
  const progress = [];
  const result = await loadReportPreview({
    loadReport: async () => ({ imageGroups: [{ category: "الموقع", urls }] }),
    loadLogos: async () => ({ owner: { name: "مالك", logoUrl: "logo" } }),
    loadAsset: async url => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return `blob:${url}`;
    },
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(peak, 2);
  assert.deepEqual(result.imageGroups[0].urls, urls.map(url => `blob:${url}`));
  assert.equal(result.companyLogos.owner.logoUrl, "blob:logo");
  assert.deepEqual(progress.at(-1), [61, 61]);
});

test("failed preparation stops queued downloads instead of continuing the entire report", async () => {
  let started = 0;
  await assert.rejects(loadReportPreview({
    loadReport: async () => ({ imageUrls: Array.from({ length: 61 }, (_, i) => `photo-${i}`) }),
    loadLogos: async () => ({}),
    loadAsset: async () => {
      started++;
      await new Promise(resolve => setTimeout(resolve, 2));
      throw new Error("offline");
    },
    onProgress: () => {},
  }), /offline/);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(started <= 7, `too many downloads started: ${started}`);
});

test("preview window opens synchronously and progress is plain text", () => {
  const originalWindow = globalThis.window;
  const status = { textContent: "" };
  let opened = false;
  let html = "";
  const win = {
    closed: false,
    document: {
      write: value => { html = value; },
      close: () => {},
      getElementById: id => id === "preview-status" ? status : null,
    },
  };
  globalThis.window = { open: () => { opened = true; return win; } };
  try {
    assert.equal(openReportPreviewWindow(), win);
    assert.ok(opened);
    assert.match(html, /جارٍ تجهيز معاينة التقرير/);
    updateReportPreviewStatus(win, "2 من 3");
    assert.equal(status.textContent, "2 من 3");
    win.closed = true;
    updateReportPreviewStatus(win, "ignored");
    assert.equal(status.textContent, "2 من 3");
    globalThis.window.open = () => null;
    assert.equal(openReportPreviewWindow(), null);
  } finally {
    globalThis.window = originalWindow;
  }
});
