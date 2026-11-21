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

test("web geofence watcher debounces entry, rearms after exit and disposes its location watch", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let positionCallback;
  let clearedWatch = null;
  let arrivals = 0;
  const geo = {
    watchPosition(success, _error, options) {
      positionCallback = success;
      assert.equal(options.enableHighAccuracy, true);
      return 17;
    },
    clearWatch(id) { clearedWatch = id; },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { geolocation: geo }, configurable: true,
  });
  try {
    const { startGeofenceWatch } = await import("../artifacts/construction-supervision/src/lib/geofence-watcher.ts");
    const watcher = startGeofenceWatch({
      projectId: 1, projectName: "fixture", siteLatitude: 1, siteLongitude: 1,
      radiusMeters: 200, onArrive: () => { arrivals++; },
    });
    const position = (latitude, accuracy = 20) => ({
      coords: { latitude, longitude: 1, accuracy },
    });
    positionCallback(position(1, 500)); // inaccurate fixes do not trigger
    assert.equal(arrivals, 0);
    positionCallback(position(1));
    positionCallback(position(1));
    assert.equal(arrivals, 1);
    positionCallback(position(1.0021)); // jitter inside the hysteresis band
    assert.equal(arrivals, 1);
    positionCallback(position(1.003)); // leave the fence and re-arm
    positionCallback(position(1));
    assert.equal(arrivals, 2);
    watcher.stop();
    assert.equal(clearedWatch, 17);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  }
});

test("mobile API attaches the current credential and renews only its matching session", async () => {
  const runtime = { credential: { token: "old-token" } };
  globalThis.__mobileApiFixture = runtime;
  const api = await bundled("artifacts/attendance-mobile/lib/api.ts", {
    "@/lib/session": `
      export const getCurrentCredential = () => globalThis.__mobileApiFixture.credential;
      export async function applyRenewedToken(token, sentToken) {
        const fixture = globalThis.__mobileApiFixture;
        if (fixture.credential?.token !== sentToken) return false;
        fixture.credential = {...fixture.credential, token};
        return true;
      }
      export async function clearCredentialForToken(sentToken) {
        const fixture = globalThis.__mobileApiFixture;
        if (fixture.credential?.token !== sentToken) return false;
        fixture.credential = null;
        return true;
      }`,
    "@/lib/session-guard": `
      export function shouldExpireSession(status, sentToken, currentToken) {
        return status === 401 && !!sentToken && sentToken === currentToken;
      }`,
  });
  const originalFetch = globalThis.fetch;
  const oldApiUrl = process.env.EXPO_PUBLIC_API_URL;
  process.env.EXPO_PUBLIC_API_URL = "https://fixture.invalid";
  try {
    let requestSeen;
    globalThis.fetch = async (url, init) => {
      requestSeen = { url, init };
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "X-Renewed-Token": "renewed-token" },
      });
    };
    assert.deepEqual(await api.apiRequest("/projects"), { ok: true });
    assert.equal(requestSeen.url, "https://fixture.invalid/api/projects");
    assert.equal(new Headers(requestSeen.init.headers).get("Authorization"), "Bearer old-token");
    assert.equal(runtime.credential.token, "renewed-token");

    runtime.credential = { token: "sent-token" };
    globalThis.fetch = async () => {
      runtime.credential = { token: "new-login-token" };
      return new Response('{"error":"expired"}', { status: 401 });
    };
    await assert.rejects(api.apiRequest("/projects"), error => error.status === 401);
    assert.equal(runtime.credential.token, "new-login-token");

    runtime.credential = { token: "current-token" };
    globalThis.fetch = async () => new Response('{"error":"expired"}', { status: 401 });
    await assert.rejects(api.apiRequest("/projects"), error => error.status === 401);
    assert.equal(runtime.credential, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = oldApiUrl;
    delete globalThis.__mobileApiFixture;
  }
});
