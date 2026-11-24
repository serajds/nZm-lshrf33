import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireApi, sharp, output, root, save } from "./common.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Development benchmark only");
await mkdir(output, { recursive: true });
const { build } = requireApi("esbuild");
const bundle = await build({
  stdin: {
    contents: `export {buildPrintHTML} from "./artifacts/construction-supervision/src/lib/report-pdf";
      export {attachProgressiveReportImages} from "./artifacts/construction-supervision/src/lib/report-preview-loader";`,
    resolveDir: root,
  },
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "ImageAudit",
});
const jpeg = await sharp({
  create: { width: 800, height: 600, channels: 3, background: "#637b91" },
}).jpeg({ quality: 85 }).toBuffer();
const thumbnail = await sharp(jpeg).resize(400, 300).jpeg().toBuffer();
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>Isolated image performance fixture</body></html>");
  } else if (/^\/photo\/\d+\?(thumbnail|photo)$/.test(req.url ?? "")) {
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
    res.end(req.url.endsWith("thumbnail") ? thumbnail : jpeg);
  } else { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let target, ws;
let sequence = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 30_000);
    pending.set(id, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const rows = [];
try {
  const response = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(5000) });
  target = await response.json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  });
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("HeapProfiler.enable");
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    for (const count of [50, 100]) {
      await send("Page.navigate", { url: origin });
      // Wait for the document rather than relying on a fixed rendering sleep.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(`location.href === ${JSON.stringify(origin + "/")} && document.readyState === 'complete'`)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await send("Runtime.evaluate", { expression: bundle.outputFiles[0].text });
      const beforeHeap = await send("Runtime.getHeapUsage");
      const result = await evaluate(`(async () => {
        const count = ${count};
        const longTasks = [];
        const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
        observer.observe({type:'longtask', buffered:false});
        const rows = [];
        const urls = Array.from({length:count}, (_,i) => '/photo/' + i);
        const at = performance.now();
        const html = ImageAudit.buildPrintHTML({
          projectName:'اختبار اصطناعي للصور', reportType:'weekly', reportId:1,
          reportDate:'2026-11-24', periodStart:'2026-11-18', periodEnd:'2026-11-24',
          workDescription:'نص التقرير قبل تحميل الصور', progressPercentage:50,
          progressiveImages:true, imageGroups:[{category:'صور اختبار اصطناعية',urls}],
        });
        const buildHtmlMs = performance.now() - at;
        document.open(); document.write(html); document.close();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const textFirstMs = performance.now() - at;
        const textPresent = document.body.textContent.includes('نص التقرير قبل تحميل الصور');
        let requests = 0, active = 0, maxActive = 0, prints = 0;
        window.print = () => { prints++; };
        window.confirm = () => false;
        const cleanup = ImageAudit.attachProgressiveReportImages({
          owner:window, imageUrls:urls,
          loadAsset:async (url,variant,signal) => {
            requests++; active++; maxActive = Math.max(active,maxActive);
            try {
              const response = await fetch(url + '?' + variant, {signal,cache:'no-store'});
              if (!response.ok) throw new Error('fixture image unavailable');
              return URL.createObjectURL(await response.blob());
            } finally { active--; }
          },
          onProgress:progress => rows.push(progress),
        });
        await new Promise(resolve => setTimeout(resolve,300));
        const initialRequests = requests;
        const printingAt = performance.now();
        document.getElementById('report-print-button').click();
        while (!prints && performance.now()-printingAt < 15000) {
          await new Promise(resolve => setTimeout(resolve,10));
        }
        const printPrepareMs = performance.now()-printingAt;
        const loadedImages = () => [...document.querySelectorAll('img[data-report-image-index]')]
          .filter(i=>i.complete && i.naturalWidth>1 && i.src.startsWith('blob:')).length;
        const decoded = loadedImages();
        const baselinePrints = prints;
        const baselineProgress = rows.at(-1);
        let recovery = null;
        if (!prints) {
          // Diagnostic intervention only; not a change to application source.
          // Native lazy images outside the viewport may never emit load for
          // setImageSource(), which holds the progressive loader's slots.
          const recoveryAt = performance.now();
          for (const image of document.querySelectorAll('img[data-report-image-index]')) image.loading = 'eager';
          while (!prints && performance.now()-recoveryAt < 10000) {
            await new Promise(resolve => setTimeout(resolve,10));
          }
          recovery = {intervention:'native_loading_eager_in_test_only',ms:performance.now()-recoveryAt,
            prints,decoded:loadedImages(),progress:rows.at(-1)};
        }
        window.auditCleanup = cleanup;
        await new Promise(resolve => setTimeout(resolve,30));
        observer.disconnect();
        return {count,buildHtmlMs,textFirstMs,textPresent,initialRequests,totalRequests:requests,
          maxActive,prints:baselinePrints,printPrepareMs,decoded,longTasks,lastProgress:baselineProgress,recovery};
      })()`);
      assert.equal(result.textPresent, true);
      assert.ok(result.initialRequests < count, "initial viewport must not fetch every photo");
      assert.ok(result.maxActive <= 2);
      let pdfMs = null, pdfBytes = null;
      // Never call an incomplete output a successful PDF. Recovery PDFs are
      // explicitly experimental and do not change the baseline FAIL result.
      if (result.prints === 1 || result.recovery?.decoded === count) {
        const printAt = performance.now();
        const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
        pdfMs = performance.now() - printAt;
        pdfBytes = Buffer.from(pdf.data, "base64");
        assert.ok(pdfBytes.subarray(0, 5).toString() === "%PDF-");
        await writeFile(path.join(output, `synthetic-${result.recovery ? "experimental-recovery-" : ""}${width}-${count}.pdf`), pdfBytes);
      }
      const heapBeforeCleanup = await send("Runtime.getHeapUsage");
      await evaluate("window.auditCleanup(); document.body.replaceChildren(); true");
      await send("HeapProfiler.collectGarbage");
      const heapAfterCleanup = await send("Runtime.getHeapUsage");
      rows.push({
        status: result.prints === 1 && result.decoded === count ? "PASS" : "FAIL",
        width, height, ...result, pdfMs, pdfBytes: pdfBytes?.length ?? null,
        beforeHeap, heapBeforeCleanup, heapAfterCleanup,
      });
      await save("browser-baseline.json", { recordedAt: new Date().toISOString(), rows, incomplete: true });
    }
  }
  await save("browser-baseline.json", {
    recordedAt: new Date().toISOString(), browser: await send("Browser.getVersion"), rows,
    scope: "Real report HTML builder + progressive loader, synthetic HTTP images, actual Chromium PDF; no authenticated API or real project images.",
    limits: ["Emulated viewport is not a physical phone", "Four cycles are not sufficient to rule out cumulative leaks", "V8 heap excludes much decoded-image/native/GPU memory", "Flat synthetic images do not establish engineering detail quality"],
  });
  console.log(JSON.stringify(rows.map(({ beforeHeap, heapBeforeCleanup, heapAfterCleanup, ...row }) => ({
    ...row, heapDeltaAfterGc: heapAfterCleanup.usedSize - beforeHeap.usedSize,
  })), null, 2));
} finally {
  if (target && ws?.readyState === WebSocket.OPEN) await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
  ws?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
