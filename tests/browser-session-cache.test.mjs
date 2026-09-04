import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createServer as createViteServer } from "../artifacts/construction-supervision/node_modules/vite/dist/node/index.js";

const appRoot = new URL("../artifacts/construction-supervision/", import.meta.url).pathname;
const workspaceRoot = new URL("../", import.meta.url).pathname;
const apiClientModule = new URL("../lib/api-client-react/src/custom-fetch.ts", import.meta.url).pathname;

function deferredResponse() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function browserHarnessPlugin(control) {
  return {
    name: "session-cache-browser-harness",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__session-test") {
          res.setHeader("Content-Type", "text/html");
          res.end(`<!doctype html><script type="module">
            import * as auth from "/src/lib/auth-session.ts";
            import * as attendance from "/src/lib/offline-attendance.ts";
            import { reloadOnceOnServiceWorkerUpdate } from "/src/lib/pwa-update.ts";
            import {
              createConfirmedUnauthorizedHandler,
              customFetch,
              setAuthTokenGetter,
              setAuthTokenSaver,
              setUnauthorizedHandler,
            } from "/@fs${apiClientModule}";
            setAuthTokenGetter(auth.getAuthToken);
            setAuthTokenSaver((token, requestToken) => auth.renewAuthToken(token, requestToken));
            setUnauthorizedHandler(createConfirmedUnauthorizedHandler({
              getCurrentToken: auth.getAuthToken,
              confirmRejected: async () => {
                await fetch("/api/test/confirm-rejection", { cache: "no-store" });
                return true;
              },
              onConfirmed: (rejectedToken) => auth.clearAuthSession(rejectedToken),
            }));
            const pageLoads = Number(sessionStorage.getItem("test-page-loads") || "0") + 1;
            sessionStorage.setItem("test-page-loads", String(pageLoads));
            window.testApi = {
              ...auth,
              enqueueAttendance: attendance.enqueueAttendance,
              listQueue: attendance.listQueue,
              flushQueue: attendance.flushQueue,
              pageLoads,
              startLateRenewal() {
                window.lateRenewal = customFetch("/api/test/late-renewal").catch(() => null);
              },
              awaitLateRenewal() { return window.lateRenewal; },
              startStale401() {
                window.stale401 = customFetch("/api/test/stale-401").catch(() => null);
              },
              awaitStale401() { return window.stale401; },
              startAttendanceFlush() {
                window.attendanceFlush = attendance.flushQueue();
              },
              awaitAttendanceFlush() { return window.attendanceFlush; },
              installRealUpdateReload() {
                window.removeUpdateReload = reloadOnceOnServiceWorkerUpdate();
              },
            };
          </script>`);
          return;
        }
        if (req.url === "/__release/renewal") {
          control.renewal.resolve();
          res.end("ok");
          return;
        }
        if (req.url === "/__release/confirmation") {
          control.confirmation.resolve();
          res.end("ok");
          return;
        }
        if (req.url === "/__release/attendance") {
          control.attendance.resolve();
          res.end("ok");
          return;
        }
        if (req.url === "/sw-session-v1.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(`self.addEventListener("install", e => self.skipWaiting());
            self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));`);
          return;
        }
        if (req.url === "/sw-session-v2.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.end(`importScripts("/cache-cleanup.js");
            self.addEventListener("install", e => self.skipWaiting());
            self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));`);
          return;
        }
        if (req.url === "/api/test/late-renewal") {
          control.renewalRequested = true;
          void control.renewal.promise.then(() => {
            res.statusCode = 200;
            res.setHeader("X-Renewed-Token", "late-renewal");
            res.setHeader("Content-Type", "application/json");
            res.end("{}");
          });
          return;
        }
        if (req.url === "/api/test/stale-401") {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end('{"error":"expired"}');
          return;
        }
        if (req.url === "/api/test/confirm-rejection") {
          control.confirmationRequested = true;
          void control.confirmation.promise.then(() => {
            res.statusCode = 200;
            res.end("confirmed");
          });
          return;
        }
        if (req.url?.startsWith("/api/attendance/")) {
          control.attendanceRequested = true;
          void control.attendance.promise.then(() => {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json");
            res.end('{"error":"expired"}');
          });
          return;
        }
        next();
      });
    },
  };
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.pageErrors = [];
    this.ws.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") {
          this.pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async open() { await once(this.ws, "open"); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, awaitPromise = true) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }
  close() { this.ws.close(); }
}

async function waitFor(fn, message) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw lastError || new Error(message);
}

async function openTab(debugPort, url) {
  const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  }).then((response) => response.json());
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  await waitFor(() => {
    if (cdp.pageErrors.length) throw new Error(cdp.pageErrors.join("\n"));
    return cdp.evaluate("Boolean(window.testApi)");
  }, "test harness did not load");
  return cdp;
}

function tokenFor(userId) {
  const payload = Buffer.from(JSON.stringify({ userId })).toString("base64url");
  return `header.${payload}.signature`;
}

test("real browser protects sessions, PWA updates, and queued attendance across tabs", { timeout: 45_000 }, async (t) => {
  const control = {
    renewal: deferredResponse(),
    confirmation: deferredResponse(),
    attendance: deferredResponse(),
    renewalRequested: false,
    confirmationRequested: false,
    attendanceRequested: false,
  };
  const vite = await createViteServer({
    root: appRoot,
    configFile: false,
    server: {
      host: "127.0.0.1",
      port: 0,
      fs: { allow: [workspaceRoot] },
    },
    resolve: {
      alias: {
        "@": `${appRoot}src`,
      },
    },
    plugins: [browserHarnessPlugin(control)],
    optimizeDeps: {
      noDiscovery: true,
      include: ["@tanstack/react-query", "@workspace/api-client-react"],
    },
  });
  await vite.listen();
  const address = vite.httpServer.address();
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;

  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const debugPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const browserProfile = await mkdtemp(join(tmpdir(), "session-cache-browser-"));
  const chromium = spawn("/repl/tools/bin/chromium", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`,
    "about:blank",
  ], { stdio: "ignore" });

  const tabs = [];
  try {
    await waitFor(
      () => fetch(`http://127.0.0.1:${debugPort}/json/version`).then((r) => r.ok).catch(() => false),
      "Chromium debugging endpoint did not start",
    );
    const oldTab = await openTab(debugPort, `${origin}/__session-test`);
    const newTab = await openTab(debugPort, `${origin}/__session-test`);
    tabs.push(oldTab, newTab);

    await t.test("late renewal and confirmed 401 from a stale tab preserve the newer login", async () => {
      await oldTab.evaluate(`window.testApi.replaceAuthToken("old-session")`);
      await oldTab.evaluate("window.testApi.startLateRenewal()");
      await waitFor(() => control.renewalRequested, "late renewal request was not sent");
      await newTab.evaluate(`window.testApi.replaceAuthToken("new-session")`);
      await fetch(`${origin}/__release/renewal`);
      await oldTab.evaluate("window.testApi.awaitLateRenewal()");
      assert.equal(await oldTab.evaluate("window.testApi.getAuthToken()"), "new-session");
      assert.equal(await newTab.evaluate("window.testApi.getAuthToken()"), "new-session");

      await oldTab.evaluate(`window.testApi.replaceAuthToken("rejected-session")`);
      await oldTab.evaluate("window.testApi.startStale401()");
      await waitFor(() => control.confirmationRequested, "401 confirmation request was not sent");
      await newTab.evaluate(`window.testApi.replaceAuthToken("newest-session")`);
      await fetch(`${origin}/__release/confirmation`);
      await oldTab.evaluate("window.testApi.awaitStale401()");
      assert.equal(await oldTab.evaluate("window.testApi.getAuthToken()"), "newest-session");
      assert.equal(await newTab.evaluate("window.testApi.getAuthToken()"), "newest-session");
    });

    await t.test("a new service worker deletes the legacy API cache and reloads once", async () => {
      await oldTab.evaluate(`(async () => {
        await navigator.serviceWorker.register("/sw-session-v1.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
        }
        await caches.open("api-cache");
        window.testApi.installRealUpdateReload();
        await navigator.serviceWorker.register("/sw-session-v2.js");
      })()`);
      await waitFor(
        () => oldTab.evaluate(`(async () =>
          Boolean(window.testApi) &&
          !(await caches.keys()).includes("api-cache") &&
          window.testApi.pageLoads === 2
        )()`),
        "service worker update did not clean the cache and reload once",
      );
      await delay(250);
      assert.equal(await oldTab.evaluate("window.testApi.pageLoads"), 2);
    });

    await t.test("queued attendance survives an in-flight account switch and 401", async () => {
      const ownerToken = tokenFor(101);
      const otherToken = tokenFor(202);
      await oldTab.evaluate(`window.testApi.replaceAuthToken(${JSON.stringify(ownerToken)})`);
      await oldTab.evaluate(`window.testApi.enqueueAttendance({
        clientId: "pending-attendance", projectId: 7, type: "check_in",
        latitude: 1, longitude: 2, accuracy: 3,
        selfie: new Blob(["photo"]), selfieFilename: "photo.jpg",
        capturedAt: Date.now(), userId: 101
      })`);
      await oldTab.evaluate("window.testApi.startAttendanceFlush()");
      await waitFor(() => control.attendanceRequested, "attendance request was not sent");
      await newTab.evaluate(`window.testApi.replaceAuthToken(${JSON.stringify(otherToken)})`);
      await fetch(`${origin}/__release/attendance`);
      await oldTab.evaluate("window.testApi.awaitAttendanceFlush()");
      assert.deepEqual(await oldTab.evaluate("window.testApi.listQueue().then(q => q.map(x => x.clientId))"), ["pending-attendance"]);
    });
  } finally {
    tabs.forEach((tab) => tab.close());
    chromium.kill("SIGTERM");
    await Promise.race([once(chromium, "exit"), delay(2_000)]);
    await vite.close();
    await rm(browserProfile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});