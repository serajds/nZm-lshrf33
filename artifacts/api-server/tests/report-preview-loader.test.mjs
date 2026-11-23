import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../../construction-supervision/src/lib/report-preview-loader.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { loadReportPreview, applySignedReportImageLinks, openReportPreviewWindow, updateReportPreviewStatus } =
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("report metadata and logos load in parallel without fetching report photos", async () => {
  let resolveReport, resolveLogos;
  const started = [];
  const loadedAssets = [];
  const pending = loadReportPreview({
    loadReport: () => { started.push("report"); return new Promise(resolve => { resolveReport = resolve; }); },
    loadLogos: () => { started.push("logos"); return new Promise(resolve => { resolveLogos = resolve; }); },
    loadAsset: async url => { loadedAssets.push(url); return `blob:${url}`; },
  });
  assert.deepEqual(started, ["report", "logos"]);
  resolveReport({ imageGroups: [{ category: "صور", urls: ["/api/uploads/photo.jpg"] }] });
  resolveLogos({ owner: { name: "مالك", logoUrl: "/api/uploads/logo.png" } });
  const preview = await pending;
  assert.deepEqual(loadedAssets, ["/api/uploads/logo.png"]);
  assert.deepEqual(preview.imageGroups[0].urls, ["/api/uploads/photo.jpg"]);
  assert.equal(preview.companyLogos.owner.logoUrl, "blob:/api/uploads/logo.png");
});

test("one signed-link manifest maps images and keeps order without fetching them through the API", async () => {
  const sourceUrls = ["/api/uploads/a.jpg", "/api/uploads/b.jpg", "/api/uploads/a.jpg"];
  let manifestRequests = 0;
  let assetRequests = 0;
  const preview = await loadReportPreview({
    loadReport: async () => ({ imageGroups: [{ category: "صور", urls: sourceUrls }] }),
    loadLogos: async () => ({}),
    loadSignedAssets: async () => {
      manifestRequests++;
      return {
        "/api/uploads/a.jpg": "https://storage.googleapis.com/bucket/a?X-Goog-Signature=x",
        "/api/uploads/b.jpg": "https://storage.googleapis.com/bucket/b?X-Goog-Signature=y",
      };
    },
    loadAsset: async url => { assetRequests++; return url; },
  });
  assert.equal(manifestRequests, 1);
  assert.equal(assetRequests, 0);
  assert.deepEqual(preview.imageGroups[0].urls, [
    "https://storage.googleapis.com/bucket/a?X-Goog-Signature=x",
    "https://storage.googleapis.com/bucket/b?X-Goog-Signature=y",
    "https://storage.googleapis.com/bucket/a?X-Goog-Signature=x",
  ]);
});

test("signed report links only replace same-origin upload URLs and preserve external assets", () => {
  const urls = [
    "/api/uploads/photo%20one.jpg?variant=report-photo",
    "https://example.org/image.jpg",
    "https://app.example/api/uploads/second.jpg",
  ];
  const resolved = applySignedReportImageLinks(
    urls,
    [{ category: "صور", urls }],
    {
      "/api/uploads/photo%20one.jpg": "https://storage.googleapis.com/a?X-Goog-Signature=x",
      "/api/uploads/second.jpg": "https://storage.googleapis.com/b?X-Goog-Signature=y",
    },
    "https://app.example",
  );
  assert.deepEqual(resolved.imageUrls, [
    "https://storage.googleapis.com/a?X-Goog-Signature=x",
    "https://example.org/image.jpg",
    "https://storage.googleapis.com/b?X-Goog-Signature=y",
  ]);
  assert.equal(resolved.imageGroups[0].urls[0], resolved.imageUrls[0]);
});

test("signed-link errors fail explicitly instead of silently falling back to image relay", async () => {
  await assert.rejects(loadReportPreview({
    loadReport: async () => ({ imageUrls: ["/api/uploads/photo.jpg"] }),
    loadLogos: async () => ({}),
    loadSignedAssets: async () => { throw new Error("storage unavailable"); },
    loadAsset: async url => url,
  }), /storage unavailable/);
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
