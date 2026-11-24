import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";

test("losing admission aborts body reception before its held work releases capacity", async () => {
  const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
  const express = require("express");
  const { createImageUploadRequestMiddleware, imageUploadRequest } = await import("../artifacts/api-server/src/lib/image-upload-request.ts");
  const root = await mkdtemp(path.resolve("generated-artifacts/image-request-signal-"));
  const lease = new AbortController(), stop = new AbortController();
  let entered, settled = false, released = false, context;
  const started = new Promise(resolve => { entered = resolve; });
  const adapter = createImageUploadRequestMiddleware({
    temporaryRoot: root,
    admission: { acquire: async principal => ({
      principal, kind: "upload", signal: lease.signal,
      release: async () => { assert.equal(settled, true); released = true; },
    }) },
  });
  const app = express(), parser = express.text({ type: "text/plain", limit: "1mb" });
  app.post("/upload", (req, _res, next) => { req.user = { userId: 1 }; next(); }, adapter, (req, res) => {
    context = imageUploadRequest(res);
    void context.run(async () => {
      try {
        await new Promise((resolve, reject) => {
          parser(req, res, error => error ? reject(error) : resolve());
          entered();
        });
      } finally { settled = true; }
    }).catch(() => {});
  });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const request = fetch(`http://127.0.0.1:${server.address().port}/upload`, {
      method: "POST", headers: { "Content-Type": "text/plain" }, duplex: "half", signal: stop.signal,
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{")); } }),
    }).catch(() => null);
    await started; lease.abort(); await request;
    for (let attempt = 0; attempt < 100 && !released; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(context.signal.aborted, true);
    assert.equal(settled, true); assert.equal(released, true);
  } finally {
    stop.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
