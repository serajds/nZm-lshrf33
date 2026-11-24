import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, access, rm } from "node:fs/promises";
import path from "node:path";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

test("image admission precedes parsing and cancellation retains capacity until work settles", async () => {
  process.env.NODE_ENV = "development";
  const pg = await isolatedPostgres();
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const entered = deferred(), finish = deferred(), entries = [];
  let pool, server, root;
  try {
    const schema = await import("../lib/db/src/index.ts");
    const { db, usersTable } = schema;
    pool = schema.pool;
    const { signToken } = await import("../artifacts/api-server/src/lib/auth.ts");
    const { requireAuth } = await import("../artifacts/api-server/src/middlewares/auth.ts");
    const { createImageUploadAdmission } = await import("../artifacts/api-server/src/lib/image-processing-admission.ts");
    const { createImageUploadRequestMiddleware, imageUploadRequest } = await import("../artifacts/api-server/src/lib/image-upload-request.ts");
    const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
    const express = require("express");
    const users = await db.insert(usersTable).values([1, 2].map(index => ({
      phone: `synthetic-request-${index}`, fullName: "Synthetic request", passwordHash: "unused", role: "admin",
    }))).returning();
    const tokens = users.map(user => signToken({ userId: user.id, phone: user.phone, role: user.role }));
    await mkdir("generated-artifacts", { recursive: true });
    root = await mkdtemp(path.resolve("generated-artifacts/image-request-"));
    const admission = createImageUploadAdmission(pool);
    let parsed = 0;
    const app = express();
    app.use((req, _res, next) => { req.log = { warn() {}, error() {}, info() {} }; next(); });
    app.post("/upload", requireAuth, createImageUploadRequestMiddleware({ admission, temporaryRoot: root }),
      express.json({ limit: "1kb", verify() { parsed++; } }), async (req, res) => {
        const current = imageUploadRequest(res);
        await current.run(async () => {
          const filename = path.join(root, `incoming-image-${randomUUID()}`);
          current.trackIncoming(filename);
          await writeFile(filename, "synthetic temporary image");
          if (req.body.slow) {
            entries.push({ context: current, incoming: filename });
            if (entries.length === 2) entered.resolve();
            await finish.promise;
          }
        });
        if (!res.destroyed) res.json({ ok: true });
      });
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/upload`;
    const request = (index, body, signal) => fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...(index === null ? {} : { Authorization: `Bearer ${tokens[index]}` }) },
      body, signal: signal ?? AbortSignal.timeout(5000),
    });
    assert.equal((await request(null, "{malformed")).status, 401);
    assert.equal(parsed, 0, "Unauthorized bodies must not enter JSON parsing");
    const stop = new AbortController();
    const slow = request(0, '{"slow":true}', stop.signal).catch(() => null);
    const slowTwo = request(0, '{"slow":true}', stop.signal).catch(() => null);
    await Promise.race([entered.promise, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error("request_did_not_enter_bounded_work")), 5000);
      timer.unref();
    })]);
    assert.equal((await request(0, "{malformed")).status, 429);
    assert.equal(parsed, 2, "Per-principal capacity must reject before parsing");
    assert.equal((await request(1, '{"slow":false}')).status, 200, "Another principal retains capacity");
    stop.abort();
    for (const { context } of entries) {
      if (!context.signal.aborted) await new Promise(resolve => context.signal.addEventListener("abort", resolve, { once: true }));
    }
    await Promise.all([slow, slowTwo]);
    await assert.rejects(admission.acquire(`user:${users[0].id}`), error => error.code === "principal_image_busy");
    finish.resolve();
    const recovered = [];
    try {
      for (let slot = 0; slot < 2; slot++) {
        for (let attempt = 0; attempt < 50; attempt++) {
          try { recovered.push(await admission.acquire(`user:${users[0].id}`)); break; }
          catch { await new Promise(resolve => setTimeout(resolve, 10)); }
        }
      }
      assert.equal(recovered.length, 2, "Capacity must recover after the cancelled jobs actually settle");
    } finally { await Promise.all(recovered.map(lease => lease.release())); }
    for (const { incoming } of entries) {
      await assert.rejects(access(incoming), error => error.code === "ENOENT");
    }
  } finally {
    finish.resolve();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    try { await pool?.end(); } finally { await pg.stop(); }
    if (root) await rm(root, { recursive: true, force: true });
  }
});
