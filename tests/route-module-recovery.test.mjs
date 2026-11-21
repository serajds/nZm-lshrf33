import assert from "node:assert/strict";
import test from "node:test";
import { loadRouteModule } from "../artifacts/construction-supervision/src/lib/route-module-recovery.ts";

function storage(values = new Map()) {
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const moduleError = () => new Error("Failed to fetch dynamically imported module");

test("transient page-module fetch failure retries in place without reloading", async () => {
  const state = storage();
  let calls = 0;
  let reloads = 0;
  const result = await loadRouteModule(async () => {
    calls++;
    if (calls === 1) throw moduleError();
    return { default: "page" };
  }, "activities", {
    storage: state,
    reload: () => { reloads++; },
    fallback: () => ({ default: "retry" }),
  });

  assert.deepEqual(result, { default: "page" });
  assert.equal(calls, 2);
  assert.equal(reloads, 0);
  assert.equal(state.getItem("route-chunk-retry:activities"), null);
});

test("persistent module fetch failure reloads only once and stays out of React's error path", async () => {
  const state = storage();
  let calls = 0;
  let reloads = 0;
  const pending = loadRouteModule(async () => {
    calls++;
    throw moduleError();
  }, "reports", {
    storage: state,
    reload: () => { reloads++; },
    fallback: () => ({ default: "retry" }),
  });

  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(calls, 2);
  assert.equal(reloads, 1);
  assert.equal(state.getItem("route-chunk-retry:reports"), "1");
  assert.equal(await Promise.race([pending.then(() => "settled"), Promise.resolve("pending")]), "pending");
});

test("a repeated module failure shows the explicit retry page after one in-place retry", async () => {
  const state = storage(new Map([["route-chunk-retry:files", "1"]]));
  let calls = 0;
  let reloads = 0;
  const result = await loadRouteModule(async () => {
    calls++;
    throw moduleError();
  }, "files", {
    storage: state,
    reload: () => { reloads++; },
    fallback: () => ({ default: "retry" }),
  });

  assert.deepEqual(result, { default: "retry" });
  assert.equal(calls, 2);
  assert.equal(reloads, 0);
});

test("real module evaluation errors are not retried or swallowed", async () => {
  const state = storage();
  const error = new Error("A real page initialization error");
  let calls = 0;
  await assert.rejects(loadRouteModule(async () => {
    calls++;
    throw error;
  }, "dashboard", {
    storage: state,
    reload: () => assert.fail("real code errors must not trigger a reload"),
    fallback: () => assert.fail("real code errors must not be hidden"),
  }), error);
  assert.equal(calls, 1);
});
