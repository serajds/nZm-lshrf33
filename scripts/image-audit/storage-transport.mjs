import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fixtures, output, loadSource, requireApi, distribution, save } from "./common.mjs";
import { openAuditBrowser } from "./cdp.mjs";

async function run() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.notEqual(process.env.REPLIT_DEPLOYMENT, "1");
  const bucketId = process.env.IMAGE_AUDIT_BUCKET_ID;
  assert.ok(bucketId);
  assert.ok(bucketId !== process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID, "Separate test storage required");
  await fixtures();
  const bytes = await readFile(path.join(output, "fixtures/detail.jpg"));
  const hash = data => createHash("sha256").update(data).digest("hex");
  const expected = hash(bytes);
  const { objectStorageClient, signObjectURL } = await loadSource("artifacts/api-server/src/lib/objectStorage.ts");
  const bucket = objectStorageClient.bucket(bucketId);
  const prefix = `development-image-audit/${randomUUID()}/`;
  const keys = Object.fromEntries(["base64", "binary", "direct"].map(mode => [mode, `${prefix}${mode}.jpg`]));
  await save("storage-transport-cleanup-ledger.json", {
    bucketFingerprint: hash(Buffer.from(bucketId)), keys: Object.values(keys), state: "pending",
  });
  const express = requireApi("express");
  const app = express();
  const storageRows = [];
  app.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  app.get("/", (_req, res) => res.type("html").send("<!doctype html><title>Private synthetic transport benchmark</title>"));
  app.get("/fixture", (_req, res) => res.type("image/jpeg").send(bytes));
  app.get("/sign", async (_req, res) => {
    try {
      const at = performance.now();
      const url = await signObjectURL({ bucketName: bucketId, objectName: keys.direct, method: "PUT", ttlSec: 60 });
      storageRows.push({ mode: "direct", phase: "sign", ms: performance.now() - at });
      res.json({ url });
    } catch { res.sendStatus(503); }
  });
  app.use((req, _res, next) => { req.auditAt = performance.now(); next(); });
  app.post("/proxy/:mode", express.raw({ type: "*/*", limit: "7mb" }), async (req, res) => {
    try {
      const mode = req.params.mode;
      if (mode !== "base64" && mode !== "binary") return res.sendStatus(404);
      const decodeAt = performance.now();
      const content = mode === "base64" ? Buffer.from(JSON.parse(req.body.toString("utf8")).base64, "base64") : req.body;
      const decodeMs = performance.now() - decodeAt;
      assert.equal(hash(content), expected);
      const storeAt = performance.now();
      await bucket.file(keys[mode]).save(content, { resumable: false, metadata: { contentType: "image/jpeg" } });
      storageRows.push({
        mode, phase: "proxy", receiveParseMs: decodeAt - req.auditAt, decodeMs,
        putMs: performance.now() - storeAt, contentBytes: content.length, wireBytes: req.body.length,
      });
      res.sendStatus(204);
    } catch { res.sendStatus(503); }
  });
  app.get("/verify/:mode", async (req, res) => {
    try {
      const key = keys[req.params.mode];
      if (!key) return res.sendStatus(404);
      const at = performance.now();
      const file = bucket.file(key);
      const [meta] = await file.getMetadata();
      const [stored] = await file.download();
      const verified = Number(meta.size) === bytes.length && hash(stored) === expected;
      storageRows.push({ mode: req.params.mode, phase: "verify", ms: performance.now() - at, verified });
      res.sendStatus(verified ? 204 : 409);
    } catch { res.sendStatus(503); }
  });
  // Never listen on a public interface or expose signing outside this process.
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  let browser, cleanupFailures = 0;
  try {
    browser = await openAuditBrowser(`http://127.0.0.1:${server.address().port}/`);
    const results = await browser.evaluate(`(async () => {
      const blob = await (await fetch('/fixture', {cache:'no-store'})).blob();
      const longTasks = [];
      const observer = new PerformanceObserver(list => list.getEntries().forEach(entry => longTasks.push(entry.duration)));
      observer.observe({type:'longtask',buffered:false});
      const rows = [];
      for(let iteration=0;iteration<9;iteration++){
        const order=['base64','binary','direct'];
        for(const mode of order.slice(iteration%3).concat(order.slice(0,iteration%3))){
          let target='/proxy/'+mode;
          if(mode==='direct') target=(await (await fetch('/sign',{cache:'no-store'})).json()).url;
          const taskAt=longTasks.length, before=performance.memory?.usedJSHeapSize ?? null;
          const at=performance.now();
          let body=blob;
          if(mode==='base64'){
            const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});
            body=JSON.stringify({base64:data.slice(data.indexOf(',')+1)});
          }
          const prepareMs=performance.now()-at;
          const sentAt=performance.now();
          let status=0, verified=false;
          try{
            const response=await fetch(target,{method:mode==='direct'?'PUT':'POST',body,
              headers:{'Content-Type':mode==='base64'?'text/plain':'image/jpeg'},cache:'no-store',
              credentials:'omit',signal:AbortSignal.timeout(30000)});
            status=response.status;
            verified=response.ok && (await fetch('/verify/'+mode,{cache:'no-store'})).ok;
          }catch{}
          await new Promise(resolve=>setTimeout(resolve,30));
          rows.push({iteration,mode,status,verified,prepareMs,
            endToEndVerifiedMs:performance.now()-at,uploadAndVerifyMs:performance.now()-sentAt,
            jsHeapBefore:before,jsHeapAfter:performance.memory?.usedJSHeapSize ?? null,
            longTaskMs:longTasks.slice(taskAt)});
        }
      }
      observer.disconnect();
      return {rows,longTasks};
    })()`, { timeoutMs: 120_000 });
    const summary = ["base64", "binary", "direct"].map(mode => {
      const rows = results.rows.filter(row => row.mode === mode && row.iteration > 0);
      return {
        mode, prepareMs: distribution(rows.map(row => row.prepareMs)),
        verifiedMs: distribution(rows.filter(row => row.verified).map(row => row.endToEndVerifiedMs)),
        errors: rows.filter(row => !row.verified).length,
      };
    });
    await save("storage-transport-baseline.json", {
      recordedAt: new Date().toISOString(), status: results.rows.every(row => row.verified) ? "PASS" : "FAIL",
      scope: "Same browser, fixture, isolated bucket and SHA-256 completion verification; rotating order. Private loopback proxy, not application auth or deployment edge. Direct signing excluded and recorded separately.",
      bytes: bytes.length, summary, ...results, storageRows,
    });
    console.log(JSON.stringify({ summary, productionWrites: 0 }));
  } finally {
    let browserCleanupFailed = false;
    try { await browser?.close(); } catch { browserCleanupFailed = true; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const key of Object.values(keys)) {
      try { await bucket.file(key).delete({ ignoreNotFound: true }); } catch { cleanupFailures++; }
    }
    await save("storage-transport-cleanup.json", { attempted: 3, cleanupFailures, browserCleanupFailed });
    if (!cleanupFailures) await save("storage-transport-cleanup-ledger.json", {
      bucketFingerprint: hash(Buffer.from(bucketId)), keys: Object.values(keys), state: "cleaned",
    });
    if (cleanupFailures || browserCleanupFailed) throw new Error("test_cleanup_incomplete");
  }
}
await run().catch(async error => {
  await save("storage-transport-failure.json", {
    status: "FAIL", reason: "probe_failed_without_logging_capabilities",
    code: /^[A-Z0-9_]{1,40}$/.test(String(error.code)) ? error.code : null,
  });
  console.error("Storage transport probe failed; no URLs or credentials logged.");
  process.exitCode = 1;
});
