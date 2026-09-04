import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ApiError,
  createConfirmedUnauthorizedHandler,
  customFetch,
  fetchWithSession,
  processFetchResponse,
  setAuthTokenGetter,
  setAuthTokenSaver,
  setUnauthorizedHandler,
} from "../lib/api-client-react/src/custom-fetch.ts";
import { diagnoseRejectedToken } from "../artifacts/api-server/src/lib/auth.ts";
import {
  clearAuthSession,
  getAuthSessionSnapshot,
  renewAuthToken,
  replaceAuthToken,
} from "../artifacts/construction-supervision/src/lib/auth-session.ts";
import {
  isAttendanceSessionCurrent,
  shouldRetainAttendanceResponse,
} from "../artifacts/construction-supervision/src/lib/offline-attendance-policy.ts";

function response(status, headers = {}) {
  return new Response(status === 204 ? null : "{}", {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

test("session response pipeline", async (t) => {
  await t.test("a late renewal cannot replace a newer concurrent renewal", async () => {
    let currentToken = "token-old";
    setAuthTokenGetter(() => currentToken);
    setAuthTokenSaver((renewed, requestToken) => {
      if (currentToken === requestToken) currentToken = renewed;
    });
    setUnauthorizedHandler(null);

    const pending = [];
    globalThis.fetch = () => new Promise((resolve) => pending.push(resolve));
    const first = customFetch("/api/first");
    const second = customFetch("/api/second");
    await new Promise((resolve) => setImmediate(resolve));

    pending[1](response(200, { "X-Renewed-Token": "token-newest" }));
    await second;
    pending[0](response(200, { "X-Renewed-Token": "token-stale" }));
    await first;

    assert.equal(currentToken, "token-newest");
  });

  await t.test("manual responses preserve the exact request token", async () => {
    let saved;
    setAuthTokenSaver((renewed, requestToken) => {
      saved = { renewed, requestToken };
    });
    await processFetchResponse(
      response(200, { "X-Renewed-Token": "renewed" }),
      "token-used",
    );
    assert.deepEqual(saved, { renewed: "renewed", requestToken: "token-used" });
  });

  await t.test("all transports bypass API caches and public login never carries a stale token", async () => {
    setAuthTokenGetter(() => "expired-token");
    setAuthTokenSaver(null);
    setUnauthorizedHandler(null);
    const calls = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return response(200);
    };

    await customFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone: "x", password: "y" }),
    });
    await fetchWithSession("/api/projects/1", { method: "GET" });

    assert.equal(new Headers(calls[0].init.headers).has("Authorization"), false);
    assert.equal(calls[0].init.cache, "no-store");
    assert.equal(new Headers(calls[1].init.headers).get("Authorization"), "Bearer expired-token");
    assert.equal(calls[1].init.cache, "no-store");
  });

  await t.test("concurrent 401s share one confirmation and confirmed rejection logs out once", async () => {
    let currentToken = "same-token";
    let confirmations = 0;
    let confirmed = 0;
    let release;
    const confirmation = new Promise((resolve) => { release = resolve; });
    const handler = createConfirmedUnauthorizedHandler({
      getCurrentToken: () => currentToken,
      confirmRejected: async () => {
        confirmations++;
        return confirmation;
      },
      onConfirmed: () => {
        confirmed++;
        currentToken = null;
      },
    });

    const first = handler(response(401), "same-token");
    const second = handler(response(401), "same-token");
    release(true);
    await Promise.all([first, second]);

    assert.equal(confirmations, 1);
    assert.equal(confirmed, 1);
    assert.equal(currentToken, null);
  });

  await t.test("transient 401 and stale 401 do not terminate a session", async () => {
    let currentToken = "current";
    let confirmed = 0;
    const transient = createConfirmedUnauthorizedHandler({
      getCurrentToken: () => currentToken,
      confirmRejected: async () => false,
      onConfirmed: () => { confirmed++; },
    });
    await transient(response(401), "current");
    assert.equal(confirmed, 0);

    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const stale = createConfirmedUnauthorizedHandler({
      getCurrentToken: () => currentToken,
      confirmRejected: async () => wait,
      onConfirmed: () => { confirmed++; },
    });
    const handling = stale(response(401), "current");
    currentToken = "new-login";
    release(true);
    await handling;
    await stale(response(401), "current");
    assert.equal(confirmed, 0);
  });

  await t.test("403 never enters the unauthorized handler", async () => {
    let unauthorizedCalls = 0;
    setAuthTokenGetter(() => "valid-token");
    setAuthTokenSaver(null);
    setUnauthorizedHandler(() => { unauthorizedCalls++; });
    globalThis.fetch = async () => response(403);
    await assert.rejects(() => customFetch("/forbidden"), ApiError);
    assert.equal(unauthorizedCalls, 0);
  });
});

test("token diagnostics expose timing without credential contents", () => {
  const now = 2_000;
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: 1_000, exp: 1_900 }))
    .toString("base64url");
  const diagnostic = diagnoseRejectedToken(`${header}.${payload}.invalid`, now);
  assert.deepEqual(diagnostic, {
    tokenId: diagnostic.tokenId,
    reason: "expired",
    issuedAt: 1_000,
    expiresAt: 1_900,
    ageSeconds: 1_000,
    expiredBySeconds: 100,
  });
  assert.match(diagnostic.tokenId, /^[a-f0-9]{12}$/);
  assert.deepEqual(diagnoseRejectedToken("not-a-token", now), {
    tokenId: diagnoseRejectedToken("not-a-token", now).tokenId,
    reason: "invalid",
  });
  assert.equal(JSON.stringify(diagnostic).includes(payload), false);
});

test("versioned web session store rejects stale renewal and logout writes", () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };

  replaceAuthToken("old-session");
  const firstRevision = getAuthSessionSnapshot().revision;
  replaceAuthToken("new-session");
  const current = getAuthSessionSnapshot();

  assert.equal(current.token, "new-session");
  assert.ok(current.revision > firstRevision);
  assert.equal(renewAuthToken("stale-renewal", "old-session"), false);
  assert.equal(clearAuthSession("old-session"), false);
  assert.equal(getAuthSessionSnapshot().token, "new-session");
  assert.equal(clearAuthSession("new-session"), true);
  assert.equal(getAuthSessionSnapshot().token, null);

  delete globalThis.localStorage;
});

test("web attendance queue stops on account changes and retains retryable auth/server failures", () => {
  assert.equal(isAttendanceSessionCurrent("token-a", "token-a", 10, 10), true);
  assert.equal(isAttendanceSessionCurrent("token-a", "token-b", 10, 10), false);
  assert.equal(isAttendanceSessionCurrent("token-a", "token-a", 10, 11), false);
  assert.equal(shouldRetainAttendanceResponse(401), true);
  assert.equal(shouldRetainAttendanceResponse(408), true);
  assert.equal(shouldRetainAttendanceResponse(429), true);
  assert.equal(shouldRetainAttendanceResponse(503), true);
  assert.equal(shouldRetainAttendanceResponse(400), false);
  assert.equal(shouldRetainAttendanceResponse(403), false);
});

test("PWA and mobile identity/cache boundaries remain safe", async () => {
  const [viteConfig, cleanup, mobileQueue, mobileAuth, mobileApi, webQueue, serverApp] = await Promise.all([
    readFile("artifacts/construction-supervision/vite.config.ts", "utf8"),
    readFile("artifacts/construction-supervision/public/cache-cleanup.js", "utf8"),
    readFile("artifacts/mobile/lib/offlineQueue.ts", "utf8"),
    readFile("artifacts/mobile/context/AuthContext.tsx", "utf8"),
    readFile("artifacts/mobile/lib/api.ts", "utf8"),
    readFile("artifacts/construction-supervision/src/lib/offline-attendance.ts", "utf8"),
    readFile("artifacts/api-server/src/app.ts", "utf8"),
  ]);

  assert.equal(viteConfig.includes('cacheName: "api-cache"'), false);
  assert.match(viteConfig, /handler: "NetworkOnly"/);
  assert.match(viteConfig, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(cleanup, /key === "api-cache"/);
  assert.equal(cleanup.includes("attendance_offline_queue"), false);
  assert.match(mobileQueue, /ownerUserId: number/);
  assert.match(mobileQueue, /QUARANTINE_KEY/);
  assert.match(mobileQueue, /function serialized</);
  assert.match(mobileQueue, /item\.ownerUserId === ownerUserId/);
  assert.match(mobileAuth, /auth_credentials_v2/);
  assert.match(mobileAuth, /await apiGetMe\(\)/);
  assert.match(mobileAuth, /_hydratingRevision === _authRevision/);
  assert.match(mobileAuth, /credentials = \{ token: _currentToken, user: freshUser \}/);
  assert.match(mobileAuth, /unregisterCurrentToken\(sessionToken\)/);
  assert.match(mobileApi, /Authorization: `Bearer \$\{sessionToken\}`/);
  assert.match(mobileApi, /publicAuthRequest/);
  assert.match(mobileApi, /cache: "no-store"/);
  assert.match(webQueue, /Authorization: `Bearer \$\{requestToken\}`/);
  assert.match(webQueue, /isAttendanceSessionCurrent/);
  assert.match(webQueue, /shouldRetainAttendanceResponse/);
  assert.equal(serverApp.includes('"Cache-Control", "public, max-age=86400"'), false);
  assert.match(serverApp, /private, no-store, no-cache, must-revalidate/);
});