import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const webRoot = new URL("../../construction-supervision/", import.meta.url);
const webRequire = createRequire(new URL("package.json", webRoot));
const { QueryClient, QueryObserver } = webRequire("@tanstack/react-query");
async function bundle(contents) {
  const result = await build({
    stdin: { contents, resolveDir: fileURLToPath(new URL("src/lib", webRoot)), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const session = await bundle('export * from "./auth-session"; export * from "./auth-bootstrap";');
const transport = await bundle(`export { createConfirmedUnauthorizedHandler } from "${fileURLToPath(new URL("../../../lib/api-client-react/src/custom-fetch.ts", import.meta.url))}";`);
let storage;
beforeEach(() => {
  storage = new Map();
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  };
  globalThis.window = new EventTarget();
});
const userA = { id: 1, fullName: "Synthetic A", role: "engineer" };
const userB = { id: 2, fullName: "Synthetic B", role: "engineer" };

test("rolling renewals preserve session lineage, cached identity and auth query key", () => {
  const first = session.replaceAuthToken("synthetic-a");
  session.writeCachedUser(userA, first);
  const key = session.getAuthUserQueryKey(first);
  const client = new QueryClient();
  client.setQueryData(["report", 1], { unsavedMarker: true });
  let live = first;
  window.addEventListener(session.AUTH_SESSION_EVENT, () => {
    const next = session.getAuthSessionSnapshot();
    if (!session.isSameAuthSession(live, next)) client.clear();
    live = next;
  });
  assert.equal(session.renewAuthToken("synthetic-a-renewed", "synthetic-a"), true);
  assert.equal(session.isSameAuthSession(first, live), true);
  assert.deepEqual(session.getAuthUserQueryKey(live), key);
  assert.deepEqual(session.readCachedUser(live), userA);
  assert.deepEqual(client.getQueryData(["report", 1]), { unsavedMarker: true });
  client.clear();
});

test("account replacement changes lineage even when server token strings are identical", () => {
  const first = session.replaceAuthToken("same-synthetic-string");
  session.writeCachedUser(userA, first);
  const second = session.replaceAuthToken("same-synthetic-string");
  assert.equal(session.isSameAuthSession(first, second), false);
  assert.notDeepEqual(session.getAuthUserQueryKey(first), session.getAuthUserQueryKey(second));
  assert.equal(session.readCachedUser(second), undefined);
});

test("late account-A cache writes and renewals cannot overwrite account B", () => {
  const first = session.replaceAuthToken("synthetic-a");
  session.writeCachedUser(userA, first);
  const second = session.replaceAuthToken("synthetic-b");
  session.writeCachedUser(userB, second);
  session.writeCachedUser(userA, first);
  assert.equal(session.renewAuthToken("late-a", "synthetic-a"), false);
  assert.equal(session.clearAuthSession("synthetic-a"), false);
  assert.equal(session.getAuthToken(), "synthetic-b");
  assert.deepEqual(session.readCachedUser(second), userB);
});

test("logout and cross-tab replacement do not preserve another account's cached user", () => {
  const first = session.replaceAuthToken("synthetic-a");
  session.writeCachedUser(userA, first);
  // Another tab writes a new complete session to the shared local store.
  localStorage.setItem("auth_token", "synthetic-b");
  localStorage.setItem("auth_session_v1", JSON.stringify({
    token: "synthetic-b", revision: first.revision + 1, sessionId: "other-tab-session", updatedAt: Date.now(),
  }));
  const second = session.getAuthSessionSnapshot();
  assert.equal(session.isSameAuthSession(first, second), false);
  assert.equal(session.readCachedUser(second), undefined);
  assert.equal(session.clearAuthSession("synthetic-b"), true);
  const guest = session.getAuthSessionSnapshot();
  assert.equal(guest.token, null);
  assert.equal(guest.sessionId, null);
  assert.equal(session.readCachedUser(guest), undefined);
});

test("existing session metadata migrates conservatively and survives its next renewal", () => {
  localStorage.setItem("auth_token", "legacy-synthetic");
  localStorage.setItem("auth_session_v1", JSON.stringify({ token: "legacy-synthetic", revision: 100, updatedAt: 100 }));
  localStorage.setItem("auth_user_cache", JSON.stringify({ token: "legacy-synthetic", user: userA }));
  const first = session.getAuthSessionSnapshot();
  assert.deepEqual(session.readCachedUser(first), userA);
  session.writeCachedUser(userA, first);
  assert.equal(session.renewAuthToken("legacy-renewed", "legacy-synthetic"), true);
  const renewed = session.getAuthSessionSnapshot();
  assert.equal(session.isSameAuthSession(first, renewed), true);
  assert.deepEqual(session.readCachedUser(renewed), userA);
});

test("a token without trusted lineage is never treated as a known same-account renewal", () => {
  localStorage.setItem("auth_token", "legacy-without-metadata");
  const previous = session.getAuthSessionSnapshot();
  session.renewAuthToken("renewed", "legacy-without-metadata");
  assert.equal(session.isSameAuthSession(previous, session.getAuthSessionSnapshot()), false);
});

test("network errors show connection recovery, never a guest state with no error", () => {
  assert.deepEqual(session.getAuthBootstrapState(true, false, false, true), {
    isLoading: false, isAuthenticated: false, connectionError: true,
  });
  assert.deepEqual(session.getAuthBootstrapState(true, false, true, false), {
    isLoading: true, isAuthenticated: false, connectionError: false,
  });
  assert.deepEqual(session.getAuthBootstrapState(false, false, true, false), {
    isLoading: false, isAuthenticated: false, connectionError: false,
  });
  assert.deepEqual(session.getAuthBootstrapState(true, true, false, true), {
    isLoading: false, isAuthenticated: true, connectionError: true,
  });
});

test("auth deadline times out and aborts transport without clearing a stored session", async () => {
  session.replaceAuthToken("synthetic-a");
  let signal;
  await assert.rejects(session.withAuthDeadline(requestSignal => {
    signal = requestSignal;
    return new Promise(() => {});
  }, undefined, 10), error => error.name === "TimeoutError");
  assert.equal(signal.aborted, true);
  assert.equal(session.getAuthToken(), "synthetic-a");
});

test("request cancellation propagates and a successful check clears its deadline", async () => {
  const parent = new AbortController();
  const pending = session.withAuthDeadline(() => new Promise(() => {}), parent.signal, 1000);
  parent.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let calls = 0;
  await assert.rejects(session.withAuthDeadline(async () => { calls++; }, alreadyAborted.signal),
    error => error.name === "AbortError");
  assert.equal(calls, 0);
  let successSignal;
  assert.equal(await session.withAuthDeadline(async signal => { successSignal = signal; return 42; }, undefined, 10), 42);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(successSignal.aborted, false);
});

test("cached user renders immediately and refetchOnMount always revalidates once in background", async () => {
  const snapshot = session.replaceAuthToken("synthetic-a");
  session.writeCachedUser(userA, snapshot);
  const client = new QueryClient();
  let resolve;
  let calls = 0;
  const observer = new QueryObserver(client, {
    queryKey: session.getAuthUserQueryKey(snapshot),
    initialData: session.readCachedUser(snapshot), staleTime: 300000, refetchOnMount: "always",
    retry: false,
    queryFn: () => { calls++; return new Promise(done => { resolve = done; }); },
  });
  const off = observer.subscribe(() => {});
  assert.deepEqual(observer.getCurrentResult().data, userA);
  assert.equal(observer.getCurrentResult().isLoading, false);
  assert.equal(calls, 1);
  resolve({ ...userA, fullName: "Updated A" });
  await new Promise(done => setImmediate(done));
  assert.equal(observer.getCurrentResult().data.fullName, "Updated A");
  off(); client.clear();
});

test("late account-A query data is isolated from account B's user query", async () => {
  const a = session.replaceAuthToken("synthetic-a");
  const client = new QueryClient();
  let resolve;
  const pending = client.fetchQuery({
    queryKey: session.getAuthUserQueryKey(a), queryFn: () => new Promise(done => { resolve = done; }),
  });
  const b = session.replaceAuthToken("synthetic-b");
  client.setQueryData(session.getAuthUserQueryKey(b), userB);
  resolve(userA);
  await pending;
  assert.deepEqual(client.getQueryData(session.getAuthUserQueryKey(b)), userB);
  client.clear();
});

test("confirmed 401 still logs out; failed confirmation and stale 401 do not", async () => {
  session.replaceAuthToken("synthetic-a");
  let confirmations = 0;
  let rejected = false;
  const handler = transport.createConfirmedUnauthorizedHandler({
    getCurrentToken: session.getAuthToken,
    confirmRejected: async () => { confirmations++; return rejected; },
    onConfirmed: token => session.clearAuthSession(token),
  });
  await handler(new Response("", { status: 401 }), "synthetic-a");
  assert.equal(session.getAuthToken(), "synthetic-a");
  session.replaceAuthToken("synthetic-b");
  await handler(new Response("", { status: 401 }), "synthetic-a");
  assert.equal(confirmations, 1);
  assert.equal(session.getAuthToken(), "synthetic-b");
  rejected = true;
  await handler(new Response("", { status: 401 }), "synthetic-b");
  assert.equal(session.getAuthToken(), null);
});

test("splash timeout preserves a recovery screen even if React never starts", () => {
  const html = readFileSync(new URL("index.html", webRoot), "utf8");
  const inline = html.match(/<script>([\s\S]*?__splashSafetyTimer[\s\S]*?)<\/script>/)[1];
  const timers = new Map();
  const retry = { hidden: true };
  const sub = { textContent: "" };
  let hidden = false;
  vm.runInNewContext(inline, {
    window: {}, setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; },
    document: {
      getElementById: id => id === "splash-retry" ? retry : { classList: { add: () => { hidden = true; } } },
      querySelector: () => sub,
    },
  });
  timers.get(12000)();
  assert.equal(retry.hidden, false);
  assert.equal(hidden, false);
  assert.match(sub.textContent, /أعد المحاولة/);
  assert.match(html, /id="splash-retry"[^>]*onclick="window.location.reload\(\)"/);
});

test("connection recovery is selected before login redirect; bootstrap revalidation is enabled", () => {
  const app = readFileSync(new URL("src/App.tsx", webRoot), "utf8");
  const router = app.slice(app.indexOf("function Router()"));
  assert.ok(router.indexOf("<AuthConnectionProblem") < router.indexOf('<Redirect to="/login"'));
  const auth = readFileSync(new URL("src/hooks/use-auth.tsx", webRoot), "utf8");
  assert.match(auth, /refetchOnMount: "always"/);
  assert.match(auth, /if \(!isSameAuthSession\(current, next\)\) \{[\s\S]*?queryClient\.clear\(\)/);
});
