// Isolated browser verification: no real API or project data is used.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.PREVIEW_TEST_ORIGIN || "http://127.0.0.1:22349";
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
let seq = 0;
let photos = 0, logos = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++seq, { resolve, reject });
  ws.send(JSON.stringify({ id: seq, method, params }));
});
ws.addEventListener("message", async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p?.reject(new Error(msg.error.message)) : p?.resolve(msg.result);
  } else if (msg.method === "Fetch.requestPaused") {
    const url = new URL(msg.params.request.url);
    if (url.searchParams.get("variant") === "report-photo") photos++;
    if (url.searchParams.get("variant") === "report-logo") logos++;
    await send("Fetch.fulfillRequest", {
      requestId: msg.params.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "image/svg+xml" }],
      body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#2f4a5c"/></svg>').toString("base64"),
    });
  }
});
async function ev(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
}
try {
  await send("Page.enable");
  await send("Runtime.enable");
  // Lightweight Vite document, avoiding loading the application or any real API.
  await send("Page.navigate", { url: `${origin}/@vite/client` });
  await new Promise(resolve => setTimeout(resolve, 500));
  await send("Page.setDocumentContent", { frameId: (await send("Page.getFrameTree")).frameTree.frame.id, html: "<html><body></body></html>" });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  const result = await ev(`(async () => {
    const RefreshRuntime = (await import('${origin}/@react-refresh')).default;
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const loader = await import('${origin}/src/lib/report-preview-loader.ts');
    const { protectedAssetToPreviewUrl } = await import('${origin}/src/components/protected-image.tsx');
    const popup = loader.openReportPreviewWindow();
    if (!popup) throw new Error('Popup blocked');
    window.testPopup = popup;
    const preview = await loader.loadReportPreview({
      loadReport: async () => ({imageUrls: Array.from({length:60}, (_, i) => '/api/uploads/fixture-photo-' + i + '.jpg')}),
      loadLogos: async () => ({owner:{name:'مالك',logoUrl:'/api/uploads/logo-fixture.png'}}),
      loadAsset: url => protectedAssetToPreviewUrl(url, popup),
      loadLogoAsset: url => protectedAssetToPreviewUrl(url, popup, 'logo'),
      onProgress: (done,total) => loader.updateReportPreviewStatus(popup, 'جارٍ تحميل صور التقرير والشعارات', done,total)
    });
    const count = popup.document.getElementById('preview-count').textContent;
    const progress = popup.document.getElementById('preview-progress').value;
    const urls = [...preview.imageUrls, preview.companyLogos.owner.logoUrl];
    popup.document.open();
    popup.document.write('<html><body>' + urls.map(url => '<img src="' + url + '">').join('') + '</body></html>');
    popup.document.close();
    await Promise.all([...popup.document.images].map(image => image.decode()));
    const decoded = [...popup.document.images].filter(i => i.naturalWidth > 0).length;
    popup.close();
    return { count, progress, decoded, allBlob: urls.every(url => url.startsWith('blob:')) };
  })()`);
  assert.deepEqual(result, { count: "61 / 61", progress: 100, decoded: 61, allBlob: true });
  assert.equal(photos, 60, "all site photos request server-compressed variants");
  assert.equal(logos, 1, "logos request the transparency-preserving variant");
  const html = await ev(`(async () => {
    const {reportPreviewScreenHtml} = await import('${origin}/src/lib/report-preview-screen.ts');
    return reportPreviewScreenHtml();
  })()`);
  assert.ok(!html.includes("gradient"));
  await mkdir("generated-artifacts/report-preview", { recursive: true });
  await writeFile("generated-artifacts/report-preview/loading.html", html);
  for (const [name, width, height] of [["desktop", 900, 780], ["mobile", 390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    await send("Page.setDocumentContent", { frameId: (await send("Page.getFrameTree")).frameTree.frame.id, html });
    assert.equal(await ev("document.documentElement.scrollWidth <= innerWidth"), true);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(`generated-artifacts/report-preview/${name}.png`, Buffer.from(shot.data, "base64"));
  }
  await ev(`(async () => {
    const loader = await import('${origin}/src/lib/report-preview-loader.ts');
    loader.showReportPreviewError(window);
  })()`);
  assert.equal(await ev("document.body.classList.contains('is-error')"), true);
  assert.equal(await ev("getComputedStyle(document.querySelector('.meter')).display"), "none");
  assert.equal(await ev("document.querySelector('#preview-title').textContent"), "تعذّر تجهيز المعاينة");
  console.log("PASS: 61 protected blobs survive document replacement and decode; desktop/mobile waiting screen; error state; no gradients.");
} finally {
  await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  ws.close();
}
