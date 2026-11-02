import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";
import { installVisiblePolling } from "../artifacts/construction-supervision/src/lib/visible-polling.ts";
import { retryRead } from "../artifacts/construction-supervision/src/lib/query-policy.ts";
import { instrumentPool, requestMetrics, newRequestMetrics } from "../lib/db/src/metrics.ts";

let sequence = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function bundled(entry, mocks) {
  const result = await build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false,
    plugins: [{ name: "native-fixtures", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${sequence++}`);
}

test("visible polling stops timers, catches up once and never overlaps; disposal is final", async () => {
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  const dateNow = Date.now, set = globalThis.setInterval, clear = globalThis.clearInterval;
  let now = 0, calls = 0, id = 0;
  const timers = new Map();
  const pending = deferred();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const window = new EventTarget();
  try {
    Object.defineProperty(globalThis, "document", { value: document, configurable: true });
    Object.defineProperty(globalThis, "window", { value: window, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
    Date.now = () => now;
    globalThis.setInterval = fn => { timers.set(++id, fn); return id; };
    globalThis.clearInterval = timer => timers.delete(timer);
    const dispose = installVisiblePolling(() => { calls++; return pending.promise; }, 100);
    assert.equal(calls, 1);
    now = 200;
    for (const timer of timers.values()) timer();
    assert.equal(calls, 1);
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(timers.size, 0);
    pending.resolve();
    await tick();
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await tick();
    assert.equal(calls, 2);
    navigator.onLine = false;
    window.dispatchEvent(new Event("offline"));
    assert.equal(timers.size, 0);
    now = 500;
    navigator.onLine = true;
    window.dispatchEvent(new Event("online"));
    await tick();
    assert.equal(calls, 3);
    dispose();
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(timers.size, 0);
    assert.equal(calls, 3);
  } finally {
    Date.now = dateNow; globalThis.setInterval = set; globalThis.clearInterval = clear;
    for (const key of ["document", "window", "navigator"]) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else delete globalThis[key];
    }
  }
});

test("permission failures and cancelled reads are never retried", () => {
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(retryRead(0, { status }), false);
  assert.equal(retryRead(0, { name: "AbortError" }), false);
  for (const status of [0, 408, 429, 500, 503]) {
    assert.equal(retryRead(0, { status }), true);
    assert.equal(retryRead(1, { status }), false);
  }
});

test("pooled callback attribution follows the requesting context, not the releasing request", async () => {
  const callbacks = [];
  const client = { query(_sql, cb) { cb(null, { rows: [] }); } };
  const pool = { connect(cb) { callbacks.push(cb); } };
  instrumentPool(pool);
  const first = newRequestMetrics(), second = newRequestMetrics();
  requestMetrics.run(first, () => pool.connect((_error, client) => client.query("select 1", () => {})));
  requestMetrics.run(second, () => pool.connect((_error, client) => client.query("select 1", () => {})));
  // Simulate pg fulfilling a queued acquisition from a different release context.
  requestMetrics.run(second, () => callbacks[0](null, client, () => {}));
  requestMetrics.run(first, () => callbacks[1](null, client, () => {}));
  assert.equal(first.queries, 1);
  assert.equal(second.queries, 1);
});

test("geofence shares one attendance read and suppresses unknown, overlapping and stale notifications", async () => {
  const runtime = { watchers: 0, removed: 0, reads: 0, notices: [], status: deferred(), callbacks: [] };
  globalThis.__geoFixture = runtime;
  const module = await bundled("artifacts/mobile/lib/geofenceReminder.ts", {
    "@react-native-async-storage/async-storage": `export default {getItem: async () => null, setItem: async () => {}};`,
    "expo-location": `
      export const Accuracy = {Balanced:1};
      export async function getForegroundPermissionsAsync(){return {granted:true};}
      export async function watchPositionAsync(_opts, callback) {
        const r=globalThis.__geoFixture; r.watchers++; r.callbacks.push(callback);
        return {remove(){r.removed++;}};
      }`,
    "expo-notifications": `export async function scheduleNotificationAsync(payload){globalThis.__geoFixture.notices.push(payload);}`,
    "./api": `
      export async function apiListProjects(){return [1,2,3].map(id=>({id,name:"fixture",siteLatitude:1,siteLongitude:1}));}
      export async function apiMyAttendanceStatus(){const r=globalThis.__geoFixture;r.reads++;return r.status.promise;}`,
  });
  await Promise.all([module.startGeofenceReminder(1), module.startGeofenceReminder(1)]);
  assert.equal(runtime.watchers, 1);
  const position = { coords: { latitude: 1, longitude: 1 } };
  runtime.callbacks[0](position);
  runtime.callbacks[0](position);
  await tick();
  assert.equal(runtime.reads, 1);
  runtime.status.reject(new Error("network unavailable"));
  await tick();
  assert.equal(runtime.notices.length, 0);
  runtime.status = deferred();
  runtime.callbacks[0](position);
  await tick();
  runtime.status.resolve([{ projectId: 1, currentlyCheckedIn: false }, { projectId: 2, currentlyCheckedIn: true }]);
  await tick();
  assert.equal(runtime.notices.length, 1);
  assert.equal(runtime.notices[0].content.data.projectId, 1);
  runtime.status = deferred();
  runtime.callbacks[0](position);
  await tick();
  module.stopGeofenceReminder();
  runtime.status.resolve([{ projectId: 2, currentlyCheckedIn: false }]);
  await tick();
  assert.equal(runtime.notices.length, 1);
  assert.equal(runtime.removed, 1);
  await module.startGeofenceReminder(2);
  runtime.callbacks[0](position); // callback retained by the old native watcher
  await tick();
  assert.equal(runtime.reads, 3);
  module.stopGeofenceReminder();
  delete globalThis.__geoFixture;
});

test("mobile identity and 401 confirmation have finite deadlines and keep valid credentials on transport failure", async () => {
  const api = await bundled("artifacts/mobile/lib/api.ts", {
    "expo-crypto": `export const randomUUID = () => "fixture";`,
    "expo-file-system/legacy": `export const EncodingType={Base64:"base64"};export async function readAsStringAsync(){return "";}`,
  });
  let current = "current", logouts = 0;
  api.setTokenGetter(() => current);
  api.setUnauthorizedHandler(() => { logouts++; current = null; });
  const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const timers = new Set();
  try {
    globalThis.setTimeout = callback => { timers.add(callback); return callback; };
    globalThis.clearTimeout = callback => timers.delete(callback);
    globalThis.fetch = () => new Promise(() => {});
    const read = api.apiGetMe();
    for (const callback of [...timers]) callback();
    await assert.rejects(read, error => error.status === 0);
    assert.equal(current, "current");
    assert.equal(logouts, 0);
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls === 1) return new Response('{"error":"rejected"}', { status: 401 });
      return new Promise(() => {});
    };
    await assert.rejects(api.apiListProjects());
    await tick();
    for (const callback of [...timers]) callback();
    await tick();
    assert.equal(logouts, 0);
    globalThis.fetch = async () => new Response('{"error":"rejected"}', { status: 401 });
    await assert.rejects(api.apiListProjects());
    await tick();
    assert.equal(logouts, 1);
  } finally {
    globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear;
  }
});
