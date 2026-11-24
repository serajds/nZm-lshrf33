import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";
import { loadSource, save, sharp } from "./common.mjs";
import { openAuditBrowser } from "./cdp.mjs";

// The configured application bucket can be shared with production. Merely
// setting NODE_ENV=development does not isolate object keys in fileStorage.ts.
// An explicitly designated, different test bucket is a mandatory write gate.
const testBucket = process.env.IMAGE_AUDIT_BUCKET_ID;
if (process.env.NODE_ENV === "production") throw new Error("Development benchmark only");
if (!testBucket || testBucket === process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
  await save("storage-baseline.json", {
    status: "BLOCKED",
    reason: !testBucket ? "isolated_test_bucket_not_configured" : "test_bucket_is_application_bucket",
    writesAttempted: 0,
    recordedAt: new Date().toISOString(),
  });
  console.error("BLOCKED: configure a separate development-only IMAGE_AUDIT_BUCKET_ID. No storage writes attempted.");
  process.exitCode = 2;
} else {
  // Import only the existing authentication/signing implementation. Do not
  // import application routes, workers, migration commands or production data.
  const { objectStorageClient, signObjectURL } = await loadSource("artifacts/api-server/src/lib/objectStorage.ts");
  const key = `development-image-audit/${randomUUID()}/synthetic.jpg`;
  const file = objectStorageClient.bucket(testBucket).file(key);
  const bytes = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#526e82" },
  }).jpeg({ quality: 85 }).toBuffer();
  const digest = value => createHash("sha256").update(value).digest("hex");
  const rows = [];
  let server, browser;
  try {
    const signAt = performance.now();
    const signed = await signObjectURL({ bucketName: testBucket, objectName: key, method: "PUT", ttlSec: 60 });
    const signMs = performance.now() - signAt;
    const putAt = performance.now();
    // Capability stays in memory only, never logged or saved in evidence.
    const response = await fetch(signed, {
      method: "PUT", body: bytes, headers: { "Content-Type": "image/jpeg" },
      signal: AbortSignal.timeout(30_000),
    });
    assert.ok(response.ok, `Direct PUT returned status ${response.status}`);
    const putMs = performance.now() - putAt;
    const verifyAt = performance.now();
    const [metadata] = await file.getMetadata();
    const [download] = await file.download();
    assert.equal(Number(metadata.size), bytes.length);
    assert.equal(digest(download), digest(bytes));
    rows.push({ status: "PASS", transport: "signed_put", signMs, putMs, verifyMs: performance.now() - verifyAt, bytes: bytes.length });
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      res.end("<!doctype html><title>Isolated storage CORS probe</title>");
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    browser = await openAuditBrowser(`http://127.0.0.1:${server.address().port}`);
    // Pass the capability only to this private browser's memory. Never put it
    // in a URL, evidence, exception description, log, HTML file or screenshot.
    const browserResult = await browser.evaluate(`(async () => {
      const at = performance.now();
      try {
        const bytes = new Uint8Array(${JSON.stringify([...bytes])});
        const response = await fetch(${JSON.stringify(signed)}, {
          method:'PUT',mode:'cors',credentials:'omit',
          headers:{'Content-Type':'image/jpeg'},body:bytes,
          signal:AbortSignal.timeout(20000)
        });
        return {status:response.ok?'PASS':'FAIL',httpStatus:response.status,putMs:performance.now()-at};
      } catch { return {status:'BLOCKED',reason:'browser_cors_or_network_failure',putMs:performance.now()-at}; }
    })()`);
    if (browserResult.status === "PASS") {
      const [afterBrowser] = await file.download();
      assert.equal(digest(afterBrowser), digest(bytes), "browser PUT must preserve bytes");
    }
    rows.push({ transport: "browser_signed_put", ...browserResult });
    await save("storage-baseline.json", {
      recordedAt: new Date().toISOString(), rows,
      scope: "Explicitly separate test bucket only; signed PUT with size and SHA-256 completion verification.",
      browserCors: browserResult,
      applicationAuthorization: "BLOCKED: direct test signing does not prove application role enforcement",
      edgeAndPwa: "BLOCKED: not measured against a deployed edge",
    });
    console.log(JSON.stringify({ durableStorage: "PASS", browserCors: browserResult.status, applicationAuthorization: "NOT_VERIFIED", productionWrites: 0 }));
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    // Only this run's random synthetic object, never application uploads.
    await file.delete({ ignoreNotFound: true });
  }
}
