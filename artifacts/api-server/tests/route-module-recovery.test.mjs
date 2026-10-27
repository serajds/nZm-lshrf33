import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const compiled = await build({
  entryPoints: ["artifacts/construction-supervision/src/lib/route-module-recovery.ts"],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { loadRouteModule } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
function fixture() {
  const values = new Map();
  let reloads = 0;
  return {
    values, get reloads() { return reloads; },
    storage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) },
    reload: () => { reloads++; }, fallback: () => "retry-screen",
  };
}
const failed = async () => { throw new TypeError("Failed to fetch dynamically imported module: /src/pages/projects/index.tsx"); };
test("initial failed request reloads once without rejecting into React", async () => {
  const f = fixture();
  let settled = false;
  void loadRouteModule(failed, "projects", f).then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.reloads, 1);
  assert.equal(settled, false);
  assert.equal(await loadRouteModule(failed, "projects", f), "retry-screen");
  assert.equal(f.reloads, 1);
});
test("successful import clears retry guard and returns the real page", async () => {
  const f = fixture();
  f.values.set("route-chunk-retry:projects", "1");
  assert.equal(await loadRouteModule(async () => "projects-page", "projects", f), "projects-page");
  assert.equal(f.values.size, 0);
});
test("blocked session storage gives manual retry, never a reload loop", async () => {
  const f = fixture();
  f.storage.getItem = () => { throw new Error("blocked"); };
  assert.equal(await loadRouteModule(failed, "projects", f), "retry-screen");
  assert.equal(f.reloads, 0);
  assert.equal(await loadRouteModule(async () => "page", "projects", f), "page");
});
test("real code errors are not mistaken for stale module requests", async () => {
  const f = fixture();
  await assert.rejects(loadRouteModule(async () => { throw new Error("Invalid hook call"); }, "projects", f), /Invalid hook call/);
  assert.equal(f.reloads, 0);
});
