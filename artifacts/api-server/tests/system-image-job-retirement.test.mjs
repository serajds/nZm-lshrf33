import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("legacy system compression is read-only and cannot overwrite image originals", async () => {
  const route = await readFile(new URL("../src/routes/system-image-compression.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/lib/system-image-compression-job-store.ts", import.meta.url), "utf8");
  await Promise.all([
    "../src/lib/system-image-compression-worker.ts",
    "../src/lib/system-image-compression.ts",
    "../src/lib/image-compression-core.ts",
  ].map(path => assert.rejects(readFile(new URL(path, import.meta.url), "utf8"), error => error.code === "ENOENT")));
  assert.match(route, /router\.post\("\/admin\/system-image-compression\/start", retiredWorker\)/);
  assert.match(route, /router\.post\("\/admin\/system-image-compression\/resume", retiredWorker\)/);
  assert.match(route, /res\.status\(410\)/);
  assert.match(store, /pauseForUnifiedPipeline/);
  assert.doesNotMatch(store, /async (?:start|claim|finish|resume)\(/);
  assert.match(store, /async getLatest/);
});
