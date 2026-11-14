import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import healthRouter from "../src/routes/health.ts";

test("API root and explicit readiness path both return healthy status", async (t) => {
  const app = express();
  app.use("/api", healthRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  for (const path of ["/api", "/api/healthz"]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { status: "ok" }, path);
  }
});
