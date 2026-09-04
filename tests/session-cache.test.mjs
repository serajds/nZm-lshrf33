import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ApiError,
  createConfirmedUnauthorizedHandler,
  customFetch,
  processFetchResponse,
  setAuthTokenGetter,
  setAuthTokenSaver,
  setUnauthorizedHandler,
} from "../lib/api-client-react/src/custom-fetch.ts";
import { diagnoseRejectedToken } from "../artifacts/api-server/src/lib/auth.ts";

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
    const first = customFetch("/first");
    const second = customFetch("/second");
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
    reason: "expired",
    issuedAt: 1_000,
    expiresAt: 1_900,
    ageSeconds: 1_000,
    expiredBySeconds: 100,
  });
  assert.deepEqual(diagnoseRejectedToken("not-a-token", now), { reason: "invalid" });
  assert.equal(JSON.stringify(diagnostic).includes(payload), false);
});

test("PWA and mobile identity/cache boundaries remain safe", async () => {
  const [viteConfig, cleanup, mobileQueue, mobileAuth, mobileApi] = await Promise.all([
    readFile("artifacts/construction-supervision/vite.config.ts", "utf8"),
    readFile("artifacts/construction-supervision/public/cache-cleanup.js", "utf8"),
    readFile("artifacts/mobile/lib/offlineQueue.ts", "utf8"),
    readFile("artifacts/mobile/context/AuthContext.tsx", "utf8"),
    readFile("artifacts/mobile/lib/api.ts", "utf8"),
  ]);

  assert.equal(viteConfig.includes('cacheName: "api-cache"'), false);
  assert.match(viteConfig, /\/api responses are deliberately NOT cached/i);
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
});