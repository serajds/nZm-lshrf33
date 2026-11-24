// Opt-in, signed-in browser image-batch flow using synthetic records and isolated storage.
// No existing project, production database, or production object bucket is used.
// NODE_ENV=development REPORT_IMAGE_UPLOAD_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/report-image-upload.browser.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { Cdp, until } from "./helpers/deviation-browser.mjs";

const { eq } = createRequire(new URL("../lib/db/package.json", import.meta.url))("drizzle-orm");
const BATCH_SIZES = [1, 10, 20, 50];

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, p50: null, max: null };
  return {
    count: sorted.length,
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    max: sorted.at(-1),
  };
}

async function makeSyntheticSitePhoto(sharp, width, height, noise, seed) {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      const block = ((Math.floor(x / 120) + Math.floor(y / 120)) % 2) * 28;
      const line = x % 180 < 3 || y % 140 < 2 ? 65 : 0;
      const detail = (x * 13 + y * 29 + (x * y) % 97 + seed * 17) % noise;
      pixels[offset] = 120 + block - line + detail;
      pixels[offset + 1] = 110 + block - line + detail;
      pixels[offset + 2] = 95 + block - line + detail;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: false })
    .toBuffer();
}

test("signed-in browser exercises report-photo batches and preview through 50 images", {
  skip: process.env.NODE_ENV !== "development"
    || process.env.REPLIT_DEPLOYMENT === "1"
    || process.env.REPORT_IMAGE_UPLOAD_BROWSER !== "1"
    || !process.env.IMAGE_AUDIT_BUCKET_ID
    || process.env.IMAGE_AUDIT_BUCKET_ID === process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  timeout: 600_000,
}, async () => {
  const postgres = await isolatedPostgres();
  let server, pool, vite, browser, cdp, previewCdp, profile, schema, objectStorage, projectId, evidence;
  let restoreBucket;
  const cleanupResult = { attempted: 0, deleteFailures: 0, stillPresent: 0, verifiedAbsent: 0 };
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  try {
    const [{ default: app }, dbSchema, { signToken }, storageModule] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../artifacts/api-server/src/lib/objectStorage.ts"),
    ]);
    schema = dbSchema;
    pool = schema.pool;
    objectStorage = storageModule.objectStorageClient;
    const realBucket = objectStorage.bucket.bind(objectStorage);
    restoreBucket = () => { objectStorage.bucket = realBucket; };
    objectStorage.bucket = (requestedId, ...args) => {
      assert.equal(requestedId, bucketId, "browser test refused non-audit storage access");
      return realBucket(requestedId, ...args);
    };

    const { db, usersTable, projectsTable, reportsTable } = schema;
    const [user] = await db.insert(usersTable).values({
      phone: "report-image-browser-fixture",
      passwordHash: "unused",
      fullName: "Report image browser fixture",
      role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "اختبار دورة صور التقرير",
      location: "isolated",
      contractor: "fixture",
      ownerEntity: "fixture",
      supervisorEntity: "fixture",
      startDate: "2026-01-01",
      expectedEndDate: "2029-12-31",
    }).returning();
    projectId = project.id;
    const reports = await db.insert(reportsTable).values(BATCH_SIZES.map((count, index) => ({
      projectId: project.id,
      reportNumber: index + 1,
      type: "weekly",
      reportDate: "2026-11-23",
      periodStart: "2026-11-16",
      periodEnd: "2026-11-23",
      workDescription: `وصف اختبار متصفح ${count} صورة`,
      progressPercentage: 24,
      imageUrls: [],
      imageGroups: [{ id: `browser-fixture-group-${count}`, category: `اختبار ${count} صورة`, urls: [] }],
      activitiesSnapshot: [],
      status: "draft",
      createdById: user.id,
    }))).returning();

    const requireFromApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
    const sharp = requireFromApi("sharp");
    profile = await mkdtemp(join(tmpdir(), "report-image-browser-"));
    const fiveMbSource = await makeSyntheticSitePhoto(sharp, 3600, 2400, 48, 1);
    const largeSource = await makeSyntheticSitePhoto(sharp, 6000, 3600, 48, 7);
    assert.ok(fiveMbSource.length >= 5 * 1024 * 1024 && fiveMbSource.length <= 20 * 1024 * 1024);
    assert.ok(largeSource.length >= 5 * 1024 * 1024 && largeSource.length <= 20 * 1024 * 1024);
    const fiveMbPath = join(profile, "site-photo-5mb.jpg");
    const twentyMbPath = join(profile, "site-photo-20mb.jpg");
    await Promise.all([writeFile(fiveMbPath, fiveMbSource), writeFile(twentyMbPath, largeSource)]);
    const smallImagePaths = [];
    for (let index = 0; index < 50; index++) {
      const filePath = join(profile, `site-photo-${String(index).padStart(2, "0")}-5mb.jpg`);
      await link(fiveMbPath, filePath);
      smallImagePaths.push(filePath);
    }
    const batches = [
      [smallImagePaths[0]],
      [twentyMbPath, ...smallImagePaths.slice(1, 10)],
      smallImagePaths.slice(10, 30),
      [twentyMbPath, ...smallImagePaths.slice(0, 49)],
    ];

    server = createServer((req, res) => app(req, res)).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { createServer: createVite } = await import("../artifacts/construction-supervision/node_modules/vite/dist/node/index.js");
    const oldPort = process.env.PORT;
    process.env.PORT = "5000";
    vite = await createVite({
      root: resolve("artifacts/construction-supervision"),
      configFile: resolve("artifacts/construction-supervision/vite.config.ts"),
      server: {
        host: "127.0.0.1", port: 0, strictPort: false,
        proxy: { "/api": { target: `http://127.0.0.1:${server.address().port}`, changeOrigin: true } },
      },
    });
    if (oldPort === undefined) delete process.env.PORT;
    else process.env.PORT = oldPort;
    await vite.listen();

    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const debugPort = probe.address().port;
    await new Promise(resolveProbe => probe.close(resolveProbe));
    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await once(cdp.ws, "open");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    const token = signToken({ userId: user.id, phone: user.phone, role: user.role });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("auth_token", ${JSON.stringify(token)});
      localStorage.setItem("pwa-install-dismissed-at", String(Date.now()));
      window.imageUploadRecords = [];
      window.imagePreparationTimings = [];
      window.imageResourceResponses = [];
      window.imageLongTasks = [];
      window.imageHeartbeatMaxGap = 0;
      performance.setResourceTimingBufferSize?.(4096);
      let lastHeartbeat = performance.now();
      setInterval(() => {
        const now = performance.now();
        window.imageHeartbeatMaxGap = Math.max(window.imageHeartbeatMaxGap, now - lastHeartbeat);
        lastHeartbeat = now;
      }, 50);
      try {
        new PerformanceObserver(list => window.imageLongTasks.push(...list.getEntries().map(entry => ({
          startTime: entry.startTime, duration: entry.duration,
        })))).observe({ type: "longtask", buffered: true });
      } catch {}
      const nativeFetch = window.fetch.bind(window);
      window.fetch = async function(input, init) {
        const rawUrl = input instanceof Request ? input.url : String(input);
        let variant = null;
        try {
          const parsed = new URL(rawUrl, window.location.href);
          if (parsed.pathname.startsWith("/api/uploads/")) {
            const candidate = parsed.searchParams.get("variant");
            if (candidate === "report-thumbnail" || candidate === "report-photo") variant = candidate;
          }
        } catch {}
        if (!variant) return nativeFetch(input, init);
        const startedAt = performance.now();
        let response;
        try {
          response = await nativeFetch(input, init);
          window.imageResourceResponses.push({
            variant, startedAt, status: response.status,
            contentLength: Number(response.headers.get("content-length")) || null,
            cacheControl: response.headers.get("cache-control"),
          });
          return response;
        } catch (error) {
          window.imageResourceResponses.push({ variant, startedAt, status: 0, error: String(error) });
          throw error;
        }
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        postMessage(message, ...transfer) {
          if (message?.file instanceof File && typeof message.id === "string") {
            const startedAt = performance.now();
            this.addEventListener("message", event => {
              if (event.data?.id !== message.id) return;
              window.imagePreparationTimings.push({
                fileName: message.file.name, sourceBytes: message.file.size,
                elapsedMs: performance.now() - startedAt,
                status: event.data.ok ? "prepared" : event.data.code,
                outputBytes: event.data.blob?.size ?? null,
                width: event.data.width ?? null, height: event.data.height ?? null,
              });
            }, { once: true });
          }
          return super.postMessage(message, ...transfer);
        }
      };
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(body) {
        if (this.__fixtureUrl?.includes("/reports/uploads")) {
          const startedAt = performance.now();
          let payload = {};
          try { payload = JSON.parse(String(body)); } catch {}
          const record = {
            fileName: payload.fileName ?? "",
            clientKey: payload.clientKey ?? "",
            payloadBytes: new TextEncoder().encode(String(body)).length,
            status: null,
          };
          window.imageUploadRecords.push(record);
          this.addEventListener("loadend", () => {
            record.status = this.status;
            record.elapsedMs = performance.now() - startedAt;
            try { record.fileUrl = JSON.parse(this.responseText).fileUrl ?? null; } catch {}
          }, { once: true });
        }
        return send.call(this, body);
      };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...args) {
        this.__fixtureUrl = String(url);
        return open.call(this, method, url, ...args);
      };
    ` });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    await cdp.send("Page.navigate", { url: `${origin}/projects/${project.id}/reports` });
    await until(() => cdp.eval(`document.querySelectorAll("tbody tr").length === ${reports.length}`));

    const clickExpressionOn = async (client, expression) => {
      await client.eval(`(()=>{const e=${expression};if(!e)throw Error("Missing target");e.scrollIntoView({block:"center"});})()`);
      const point = await client.eval(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await client.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
      await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
    };
    const clickElement = selector => clickExpressionOn(cdp, `document.querySelector(${JSON.stringify(selector)})`);
    const openEdit = async reportNumber => {
      await clickElement(`tbody tr button[aria-label="إجراءات التقرير ${reportNumber}"]`);
      await until(() => cdp.eval('!![...document.querySelectorAll("[role=menuitem]")].find(item=>item.textContent.includes("تعديل التقرير"))'));
      await clickExpressionOn(cdp, '[...document.querySelectorAll("[role=menuitem]")].find(item=>item.textContent.includes("تعديل التقرير"))');
      await until(() => cdp.eval('!!document.querySelector(\'[role="dialog"] input[type="file"]\')'));
    };
    const previewBatch = async (reportNumber, description, expectedCount, exercisePrint = false) => {
      const previousTargets = new Set((await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json())).map(item => item.id));
      const previewStarted = performance.now();
      const openerStartedAt = await cdp.eval("performance.now()");
      const responseRecordStart = await cdp.eval("window.imageResourceResponses.length");
      const previewButton = `(()=>{const action=document.querySelector('tbody tr button[aria-label="إجراءات التقرير ${reportNumber}"]');return [...action.closest("tr").querySelectorAll("button")].find(button=>button.textContent.includes("معاينة وطباعة"))})()`;
      await clickExpressionOn(cdp, previewButton);
      let target;
      await until(async () => {
        target = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(response => response.json()))
          .find(item => item.type === "page" && !previousTargets.has(item.id));
        return Boolean(target);
      });
      previewCdp = new Cdp(target.webSocketDebuggerUrl);
      await once(previewCdp.ws, "open");
      await previewCdp.send("Page.enable");
      await previewCdp.send("Runtime.enable");
      await until(async () => {
        const popupReady = await previewCdp.eval(`document.body.innerText.includes(${JSON.stringify(description)})
          && !!document.querySelector("#report-print-button")
          && document.querySelectorAll("img[data-report-image-index]").length === ${expectedCount}`);
        const openerReady = await cdp.eval(`(()=>{
          const action=document.querySelector('tbody tr button[aria-label="إجراءات التقرير ${reportNumber}"]');
          const button=action?.closest("tr")?.querySelector('button[title="معاينة وحفظ PDF"]');
          return !!button && !button.disabled;
        })()`);
        return popupReady && openerReady;
      });
      const interactiveReadyMs = performance.now() - previewStarted;
      const initialLazyState = await previewCdp.eval(`(()=>{
        const images=[...document.querySelectorAll("img[data-report-image-index]")];
        return { imageCount:images.length, ready:images.filter(image=>image.complete&&image.naturalWidth>1).length };
      })()`);
      const initialThumbnailRequests = await cdp.eval(
        `window.imageResourceResponses.slice(${responseRecordStart}).filter(row=>row.variant==="report-thumbnail").length`,
      );
      await previewCdp.eval('document.querySelector("img[data-report-image-index]")?.scrollIntoView({block:"center"})');
      await until(() => previewCdp.eval(`(()=>{
        const image=document.querySelector("img[data-report-image-index]");
        return !!image && image.complete && image.naturalWidth > 1 && image.src.startsWith("blob:");
      })()`));
      const firstImageMs = performance.now() - previewStarted;
      const thumbnailTarget = exercisePrint ? expectedCount : 1;
      const thumbnailSweepStarted = performance.now();
      for (let index = 0; index < thumbnailTarget; index++) {
        await previewCdp.eval(`document.querySelectorAll("img[data-report-image-index]")[${index}].scrollIntoView({block:"center"})`);
        await previewCdp.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      }
      await until(() => previewCdp.eval(`(()=>{
        const images=[...document.querySelectorAll("img[data-report-image-index]")];
        return images.filter(image=>image.complete&&image.naturalWidth>1&&image.src.startsWith("blob:")).length >= ${thumbnailTarget};
      })()`), expectedCount === 50 ? 120_000 : 60_000);
      const thumbnailSweepMs = performance.now() - thumbnailSweepStarted;
      const thumbnailState = await previewCdp.eval(`(()=>{
        const images=[...document.querySelectorAll("img[data-report-image-index]")];
        return { count:images.length, ready:images.filter(image=>image.complete&&image.naturalWidth>1).length,
          firstNaturalWidth:images[0]?.naturalWidth??0 };
      })()`);
      assert.equal(thumbnailState.count, expectedCount);
      assert.ok(thumbnailState.ready >= thumbnailTarget);
      const readImageNetwork = () => cdp.eval(`(()=>{
        const since=${JSON.stringify(openerStartedAt)};
        const all=performance.getEntriesByType("resource").filter(entry=>{
          if(entry.startTime<since)return false;
          try { const url=new URL(entry.name);return url.pathname.startsWith("/api/uploads/"); }
          catch { return false; }
        });
        const responses=(window.imageResourceResponses||[]).slice(${responseRecordStart});
        const summarize=variant=>{
          const entries=all.filter(entry=>{try{return new URL(entry.name).searchParams.get("variant")===variant}catch{return false}});
          const durations=entries.map(entry=>entry.responseEnd-entry.startTime).sort((a,b)=>a-b);
          const events=entries.flatMap(entry=>[{time:entry.fetchStart,delta:1},{time:entry.responseEnd,delta:-1}])
            .sort((a,b)=>a.time-b.time||a.delta-b.delta);
          let active=0,maxConcurrent=0;
          for(const event of events){active+=event.delta;maxConcurrent=Math.max(maxConcurrent,active)}
          const responseRows=responses.filter(row=>row.variant===variant);
          const uniqueControls=[...new Set(responseRows.map(row=>row.cacheControl).filter(Boolean))];
          return {
            requestCount:responseRows.length,
            resourceEntries:entries.length,
            distinctAssets:new Set(entries.map(entry=>new URL(entry.name).pathname)).size,
            encodedBodyBytes:entries.reduce((sum,entry)=>sum+entry.encodedBodySize,0),
            transferBytes:entries.reduce((sum,entry)=>sum+entry.transferSize,0),
            responseHeaderBytes:responseRows.reduce((sum,row)=>sum+(row.contentLength||0),0),
            responseStatuses:responseRows.map(row=>row.status),
            cacheControl:uniqueControls,
            p50RequestMs:durations.length?durations[Math.floor((durations.length-1)*0.5)]:null,
            maxConcurrent,
          };
        };
        return {thumbnail:summarize("report-thumbnail"),photo:summarize("report-photo")};
      })()`);
      const networkBeforeZoom = await readImageNetwork();
      assert.equal(networkBeforeZoom.thumbnail.requestCount, thumbnailTarget);
      assert.equal(networkBeforeZoom.photo.requestCount, 0, "normal preview must not fetch report-photo variants");
      const thumbnailResourcesBeforeRepeat = networkBeforeZoom.thumbnail.requestCount;
      await previewCdp.eval('document.querySelector("img[data-report-image-index]")?.scrollIntoView({block:"start"})');
      await previewCdp.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      if (expectedCount > 1) {
        await previewCdp.eval(`document.querySelectorAll("img[data-report-image-index]")[${thumbnailTarget - 1}].scrollIntoView({block:"center"})`);
        await previewCdp.eval("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      const networkAfterRepeat = await readImageNetwork();
      assert.equal(networkAfterRepeat.thumbnail.requestCount, thumbnailResourcesBeforeRepeat,
        "revisiting an already loaded thumbnail must reuse the preview-owned image");
      let zoomNaturalWidth = null, printPrepared = null;
      if (exercisePrint) {
        await clickExpressionOn(previewCdp, 'document.querySelector("img[data-report-image-index]")');
        await until(() => previewCdp.eval('!!document.querySelector("[data-report-image-zoom] img")?.complete && document.querySelector("[data-report-image-zoom] img")?.naturalWidth > 400'));
        zoomNaturalWidth = await previewCdp.eval('document.querySelector("[data-report-image-zoom] img").naturalWidth');
        await previewCdp.eval('document.querySelector("[data-report-image-zoom] button[aria-label=\\"إغلاق صورة التقرير\\"]")?.click()');
        await previewCdp.eval('window.__printCalled=0;window.print=()=>{window.__printCalled++}');
        await clickExpressionOn(previewCdp, 'document.querySelector("#report-print-button")');
        await until(() => previewCdp.eval("window.__printCalled === 1"));
        printPrepared = await previewCdp.eval(`(()=>{
          const images=[...document.querySelectorAll("img[data-report-image-index]")];
          return images.length===${expectedCount} && images.every(image=>image.complete&&image.naturalWidth>400);
        })()`);
        assert.equal(printPrepared, true);
      }
      const networkAfterPrint = await readImageNetwork();
      if (exercisePrint) {
        assert.equal(networkAfterPrint.photo.requestCount, expectedCount,
          "zoom and print should fetch the enhanced report-photo variant, not reuse thumbnails");
      }
      const state = await previewCdp.eval(`(()=>({
        textPresent:document.body.innerText.includes(${JSON.stringify(description)}),
        imageCount:document.querySelectorAll("img[data-report-image-index]").length,
        imageNaturalWidth:document.querySelector("img[data-report-image-index]")?.naturalWidth ?? 0,
        consoleErrors:window.__previewErrors||[],
      }))()`);
      assert.deepEqual(previewCdp.errors, []);
      const elapsedMs = performance.now() - previewStarted;
      await previewCdp.send("Page.close");
      previewCdp.ws.close();
      previewCdp = null;
      return {
        status: "PASS", ...state, readyThumbnails: thumbnailState.ready, elapsedMs,
        interactiveReadyMs, initialLazyState, initialThumbnailRequests, firstImageMs, thumbnailSweepMs,
        zoomNaturalWidth, printPrepared,
        networkBeforeZoom, networkAfterRepeat, networkAfterPrint,
      };
    };

    const batchEvidence = [];
    const savedUrlsByReport = new Map();
    let cumulativeUploads = 0;
    const browserHeapBefore = await cdp.eval("performance.memory?.usedJSHeapSize ?? null");
    for (let batchIndex = 0; batchIndex < BATCH_SIZES.length; batchIndex++) {
      const count = BATCH_SIZES[batchIndex];
      const report = reports.find(item => item.reportNumber === batchIndex + 1);
      const files = batches[batchIndex];
      const fileNames = files.map(filePath => filePath.split("/").at(-1));
      assert.equal(files.length, count);
      await openEdit(report.reportNumber);
      const recordStart = await cdp.eval("window.imageUploadRecords.length");
      const preparationStart = await cdp.eval("window.imagePreparationTimings.length");
      await cdp.eval("window.imageHeartbeatMaxGap=0;window.__imageBatchStarted=performance.now()");
      const heapBeforeUpload = await cdp.eval("performance.memory?.usedJSHeapSize ?? null");
      const uploadStarted = performance.now();
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId, selector: '[role="dialog"] input[type="file"]',
      });
      assert.ok(nodeId > 0);
      await cdp.send("DOM.setFileInputFiles", { files, nodeId });
      await until(() => cdp.eval(`document.querySelectorAll('[role="dialog"] img').length >= ${count}`),
        count === 50 ? 180_000 : 90_000);
      await until(() => cdp.eval(`(()=>{
        const records=window.imageUploadRecords.slice(${recordStart});
        return new Set(records.filter(record=>record.status===201).map(record=>record.clientKey)).size >= ${count};
      })()`), count === 50 ? 180_000 : 90_000);
      await until(() => cdp.eval(`window.imagePreparationTimings.length >= ${preparationStart + count}`),
        count === 50 ? 180_000 : 90_000);
      const queueElapsedMs = performance.now() - uploadStarted;
      const attempts = await cdp.eval(`window.imageUploadRecords.slice(${recordStart})`);
      const preparations = await cdp.eval(`window.imagePreparationTimings.slice(${preparationStart},${preparationStart + count})`);
      const successfulByKey = new Map(attempts.filter(request => request.status === 201)
        .map(request => [request.clientKey, request]));
      const requests = fileNames.map(fileName => attempts.findLast(request =>
        request.fileName === fileName && request.status === 201));
      assert.equal(successfulByKey.size, count);
      assert.equal(preparations.length, count);
      assert.ok(requests.every(request => request?.status === 201 && request.fileUrl));
      assert.ok(preparations.every(image => image.status === "prepared" && image.outputBytes <= 350 * 1024));
      assert.equal(new Set(requests.map(request => request.fileName)).size, count);
      assert.ok(requests.every(request => fileNames.includes(request.fileName)));
      const orderedUrls = fileNames.map(fileName => requests.find(request => request.fileName === fileName)?.fileUrl);
      assert.ok(orderedUrls.every(Boolean));

      const saveStarted = performance.now();
      await clickElement('[role="dialog"] button[type="submit"]');
      await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')'));
      const apiUrl = `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/reports/${report.id}`;
      let savedReport;
      await until(async () => {
        const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return false;
        savedReport = await response.json();
        return savedReport.imageGroups?.[0]?.urls?.length === count;
      });
      const saveRoundTripMs = performance.now() - saveStarted;
      assert.deepEqual(savedReport.imageGroups[0].urls, orderedUrls, `selected-file order must survive ${count} uploads`);
      savedUrlsByReport.set(report.reportNumber, orderedUrls);
      cumulativeUploads += count;
      const browserAssets = await db.select().from(schema.imageAssetsTable)
        .where(eq(schema.imageAssetsTable.projectId, project.id));
      assert.equal(browserAssets.length, cumulativeUploads);
      assert.ok(browserAssets.every(asset => asset.profile === "report" && asset.state === "ready"
        && asset.thumbnailKey && asset.printKey && asset.byteSize <= 350 * 1024
        && asset.width <= 1600 && asset.height <= 1600));
      const byUrl = new Map(browserAssets.map(asset => [
        `/api/uploads/${asset.storageKey.split("/").at(-1)}`, asset,
      ]));
      for (const url of savedReport.imageGroups[0].urls) assert.ok(byUrl.has(url));
      const heapAfterUpload = await cdp.eval("performance.memory?.usedJSHeapSize ?? null");
      const browserResponsiveness = await cdp.eval(`(()=>{
        const start=window.__imageBatchStarted;
        return {
          heartbeatMaxGapMs:window.imageHeartbeatMaxGap,
          longTasks:window.imageLongTasks.filter(task=>task.startTime>=start).map(task=>task.duration),
        };
      })()`);
      const preview = await previewBatch(report.reportNumber, `وصف اختبار متصفح ${count} صورة`, count, count === 50);
      assert.equal(preview.textPresent, true);
      assert.equal(preview.imageCount, count);
      assert.deepEqual(cdp.errors, []);
      batchEvidence.push({
        batchSize: count,
        reportId: report.id,
        sourceFiles: files.map(filePath => ({
          name: filePath.split("/").at(-1),
          bytes: filePath === batches[1][0] || (batchIndex === 3 && filePath === batches[3][0])
            ? largeSource.length : fiveMbSource.length,
        })),
        sourceBytesTotal: files.reduce((total, filePath) => total
          + (filePath === twentyMbPath ? largeSource.length : fiveMbSource.length), 0),
        upload: {
          status: "PASS", requestCount: requests.length,
          p50Ms: summarize(requests.map(request => request.elapsedMs)).p50,
          maxMs: summarize(requests.map(request => request.elapsedMs)).max,
          bytesSent: requests.reduce((total, request) => total + request.payloadBytes, 0),
          attempts: attempts.length,
          recoveredRetries: attempts.filter(request => request.status === 429 || request.status >= 500).length,
          queueElapsedMs,
        },
        localPreparation: {
          p50Ms: summarize(preparations.map(image => image.elapsedMs)).p50,
          maxMs: summarize(preparations.map(image => image.elapsedMs)).max,
          preparedBytes: preparations.reduce((total, image) => total + image.outputBytes, 0),
          outputs: preparations.map(image => ({
            sourceBytes: image.sourceBytes, outputBytes: image.outputBytes, width: image.width, height: image.height,
          })),
        },
        reportSave: { status: "PASS", roundTripMs: saveRoundTripMs, imageReferences: savedReport.imageGroups[0].urls.length },
        preview,
        browserHeapBytes: { beforeUpload: heapBeforeUpload, afterUpload: heapAfterUpload },
        browserResponsiveness,
      });
    }
    await openEdit(4);
    const workDescription = "وصف بعد تعديل التقرير في اختبار دورة الصور";
    await cdp.eval('document.querySelector(\'[role="dialog"] textarea[name="workDescription"]\')?.focus()');
    await cdp.eval('document.querySelector(\'[role="dialog"] textarea[name="workDescription"]\')?.select()');
    await cdp.send("Input.insertText", { text: workDescription });
    await clickElement('[role="dialog"] button[type="submit"]');
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')'));
    const editedReportResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/${project.id}/reports/${reports[3].id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    assert.equal(editedReportResponse.status, 200);
    const editedReport = await editedReportResponse.json();
    assert.equal(editedReport.workDescription, workDescription);
    assert.deepEqual(editedReport.imageGroups[0].urls, savedUrlsByReport.get(4));
    evidence = { reportEditRetention: { status: "PASS", imageReferences: editedReport.imageGroups[0].urls.length } };
    const heapAfterAll = await cdp.eval("performance.memory?.usedJSHeapSize ?? null");
    const uploadRequests = await cdp.eval("window.imageUploadRecords");
    evidence = {
      ...evidence,
      recordedAt: new Date().toISOString(),
      status: "PASS",
      environment: "development",
      database: "fresh private PostgreSQL cluster",
      storage: "isolated audit bucket only",
      browser: "headless Chromium with a synthetic admin session token",
      scope: "real signed-in report UI/API; original synthetic photos; batch sizes 1, 10, 20 and 50",
      sourcePolicy: {
        filesBetween5And20MiB: true,
        smallSourceBytes: fiveMbSource.length,
        largeSourceBytes: largeSource.length,
        largeImagePixels: 6000 * 3600,
        distinctSyntheticPatterns: 2,
        reusedBytesAcrossUniqueFilenames: true,
        syntheticImagesOnly: true,
      },
      upload: {
        status: new Set(uploadRequests.filter(request => request.status === 201).map(request => request.clientKey)).size === 81
          ? "PASS" : "FAIL",
        requests: uploadRequests,
        requestCount: new Set(uploadRequests.filter(request => request.status === 201).map(request => request.clientKey)).size,
        localPreparationCount: batchEvidence.reduce((sum, batch) => sum + batch.batchSize, 0),
      },
      batches: batchEvidence,
      orderPreserved: true,
      browserHeapBytes: { beforeBatches: browserHeapBefore, afterBatches: heapAfterAll },
      limitations: [
        "81 filenames reuse two synthetic source patterns; they are not real site photos",
        "desktop headless Chromium only; Android/iOS/PWA and physical devices not tested",
      ],
    };
    assert.equal(evidence.upload.status, "PASS");
    assert.equal(batchEvidence.length, 4);
    assert.equal(cumulativeUploads, 81);
    assert.deepEqual(cdp.errors, []);
  } finally {
    if (browser) {
      cdp?.ws.close();
      previewCdp?.ws.close();
      browser.kill("SIGTERM");
      if (browser.exitCode == null) await once(browser, "exit");
    }
    await vite?.close();
    if (server) await new Promise(resolveServer => server.close(resolveServer));
    const storage = objectStorage;
    if (storage && bucketId) {
      if (schema && projectId) {
        try {
          const assets = await schema.db.select({
            storageKey: schema.imageAssetsTable.storageKey,
            thumbnailKey: schema.imageAssetsTable.thumbnailKey,
            printKey: schema.imageAssetsTable.printKey,
            attemptHistory: schema.imageAssetsTable.attemptHistory,
          }).from(schema.imageAssetsTable).where(eq(schema.imageAssetsTable.projectId, projectId));
          for (const asset of assets) {
            const exactKeys = new Set([
              asset.storageKey, asset.thumbnailKey, asset.printKey,
              ...(asset.attemptHistory ?? []).flatMap(attempt => [attempt.storageKey, attempt.thumbnailKey, attempt.printKey]),
            ].filter(Boolean));
            for (const key of exactKeys) {
              if (!key) continue;
              const file = storage.bucket(bucketId).file(key);
              cleanupResult.attempted++;
              try { await file.delete({ ignoreNotFound: true }); }
              catch { cleanupResult.deleteFailures++; }
              try {
                const [exists] = await file.exists();
                if (exists) cleanupResult.stillPresent++;
                else cleanupResult.verifiedAbsent++;
              } catch { cleanupResult.deleteFailures++; }
            }
          }
        } catch { /* keep cleanup best-effort inside the private test database */ }
      }
      restoreBucket?.();
    }
    if (evidence) {
      evidence.cleanup = {
        ...cleanupResult,
        status: cleanupResult.deleteFailures === 0 && cleanupResult.stillPresent === 0 ? "PASS" : "FAIL",
        scope: "only exact synthetic image keys recorded in the isolated database",
      };
      const outputDir = resolve("generated-artifacts/image-audit");
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, "signed-browser-flow.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
      assert.equal(evidence.cleanup.status, "PASS", "synthetic browser storage cleanup must be verified");
    } else {
      const outputDir = resolve("generated-artifacts/image-audit");
      await mkdir(outputDir, { recursive: true });
      await writeFile(resolve(outputDir, "signed-browser-last-cleanup.json"), `${JSON.stringify({
        ...cleanupResult,
        status: cleanupResult.deleteFailures === 0 && cleanupResult.stillPresent === 0 ? "PASS" : "FAIL",
        scope: "exact synthetic asset keys discoverable in the isolated test database",
      }, null, 2)}\n`, { mode: 0o600 });
    }
    await pool?.end().catch(() => {});
    await postgres.stop();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
