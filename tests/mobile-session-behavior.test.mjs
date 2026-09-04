import assert from "node:assert/strict";
import test from "node:test";
import { build } from "../artifacts/api-server/node_modules/esbuild/lib/main.js";

let bundleSequence = 0;

async function importBundled(entry, mocks) {
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    plugins: [{
      name: "mobile-native-test-mocks",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (Object.hasOwn(mocks, args.path)) {
            return { path: args.path, namespace: "mobile-test-mock" };
          }
          return undefined;
        });
        builder.onLoad({ filter: /.*/, namespace: "mobile-test-mock" }, (args) => ({
          contents: mocks[args.path],
          loader: "js",
        }));
      },
    }],
  });
  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}#${++bundleSequence}`;
  return import(url);
}

const authMocks = {
  react: `
    const r = globalThis.__mobileAuthTest;
    export function createContext() {
      return { Provider: ({ value, children }) => { r.context = value; return children; } };
    }
    export function useContext(ctx) { return r.context ?? ctx; }
    export function useEffect(effect) { r.cleanups.push(effect()); }
    export function useMemo(factory) { return factory(); }
    export function useCallback(callback) { r.callbacks.push(callback); return callback; }
    export function useState(initial) {
      const index = r.stateSlots.length;
      r.stateSlots.push(typeof initial === "function" ? initial() : initial);
      return [r.stateSlots[index], (next) => {
        const previous = r.stateSlots[index];
        r.stateSlots[index] = typeof next === "function" ? next(previous) : next;
      }];
    }
    export const createElement = () => null;
    export default { createElement };
  `,
  "react/jsx-runtime": `
    export const Fragment = Symbol("Fragment");
    export function jsx(type, props) { return typeof type === "function" ? type(props) : null; }
    export const jsxs = jsx;
  `,
  "react-native": `
    export const Alert = { alert: (...args) => globalThis.__mobileAuthTest.alerts.push(args) };
  `,
  "expo-router": `
    export const router = { replace: (path) => { globalThis.__mobileAuthTest.redirects.push(path); } };
  `,
  "expo-secure-store": `
    const r = globalThis.__mobileAuthTest;
    export async function getItemAsync(key) { return r.storage.has(key) ? r.storage.get(key) : null; }
    export async function setItemAsync(key, value) { r.storage.set(key, value); }
    export async function deleteItemAsync(key) { r.storage.delete(key); }
  `,
  "@/lib/api": `
    const r = globalThis.__mobileAuthTest;
    export class ApiError extends Error {
      constructor(message, status) { super(message); this.status = status; }
    }
    export function setTokenGetter(getter) { r.getToken = getter; }
    export function setTokenSaver(saver) { r.saveToken = saver; }
    export function setUnauthorizedHandler(handler) { r.unauthorized = handler; }
    export async function apiGetMe() {
      if (r.meStatus === 401) throw new ApiError("unauthorized", 401);
      const used = r.getToken();
      if (r.renewedToken) r.saveToken(r.renewedToken, used);
      return r.freshUser;
    }
    export async function apiLogin() { return r.loginResponse; }
  `,
  "@/lib/expoPush": `
    const r = globalThis.__mobileAuthTest;
    export async function registerForPushNotificationsAsync() { r.registered++; return null; }
    export async function unregisterCurrentToken(token) { r.unregisteredWith.push(token); }
  `,
};

function authRuntime(overrides = {}) {
  return {
    storage: new Map(),
    stateSlots: [],
    callbacks: [],
    cleanups: [],
    alerts: [],
    redirects: [],
    unregisteredWith: [],
    registered: 0,
    meStatus: 200,
    renewedToken: null,
    freshUser: { id: 1, phone: "1", fullName: "Fresh", role: "engineer" },
    loginResponse: null,
    getToken: () => null,
    saveToken: () => {},
    unauthorized: () => {},
    ...overrides,
  };
}

async function settle() {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("mobile auth hydration adopts renewal atomically and logout keeps unregister authenticated", async () => {
  const oldUser = { id: 1, phone: "1", fullName: "Cached", role: "engineer" };
  const runtime = authRuntime({ renewedToken: "token-renewed" });
  runtime.storage.set("auth_credentials_v2", JSON.stringify({ token: "token-old", user: oldUser }));
  globalThis.__mobileAuthTest = runtime;
  const authModule = await importBundled("artifacts/mobile/context/AuthContext.tsx", authMocks);

  authModule.AuthProvider({ children: null });
  await settle();

  assert.deepEqual(runtime.stateSlots[0], {
    ready: true,
    user: runtime.freshUser,
    token: "token-renewed",
  });
  assert.deepEqual(JSON.parse(runtime.storage.get("auth_credentials_v2")), {
    token: "token-renewed",
    user: runtime.freshUser,
  });
  assert.equal(runtime.storage.has("auth_token"), false);
  assert.equal(runtime.storage.has("auth_user"), false);

  const logout = runtime.callbacks[1];
  await logout();
  assert.deepEqual(runtime.unregisteredWith, ["token-renewed"]);
  assert.equal(runtime.storage.has("auth_credentials_v2"), false);
  assert.deepEqual(runtime.stateSlots[0], { ready: true, user: null, token: null });
});

test("mobile auth rejects a persisted identity when its token is rejected", async () => {
  const cached = { id: 8, phone: "8", fullName: "Old", role: "engineer" };
  const runtime = authRuntime({ meStatus: 401 });
  runtime.storage.set("auth_credentials_v2", JSON.stringify({ token: "expired", user: cached }));
  globalThis.__mobileAuthTest = runtime;
  const authModule = await importBundled("artifacts/mobile/context/AuthContext.tsx", authMocks);

  authModule.AuthProvider({ children: null });
  await settle();

  assert.deepEqual(runtime.stateSlots[0], { ready: true, user: null, token: null });
  assert.equal(runtime.storage.has("auth_credentials_v2"), false);
});

const queueMocks = {
  "@react-native-async-storage/async-storage": `
    const r = globalThis.__mobileQueueTest;
    export default {
      async getItem(key) { return r.storage.has(key) ? r.storage.get(key) : null; },
      async setItem(key, value) { r.storage.set(key, value); },
      async removeItem(key) { r.storage.delete(key); },
    };
  `,
  "expo-crypto": `export function randomUUID() { return "generated-id"; }`,
  "expo-file-system/legacy": `
    export const documentDirectory = "file:///queue-test/";
    export async function getInfoAsync() { return { exists: true }; }
    export async function makeDirectoryAsync() {}
    export async function copyAsync() {}
    export async function deleteAsync() {}
  `,
  "./api": `
    const r = globalThis.__mobileQueueTest;
    export class ApiError extends Error {
      constructor(message, status) { super(message); this.status = status; }
    }
    export async function apiAttendanceCheck(item) {
      r.sent.push(item);
      return r.send(item);
    }
  `,
};

function queueItem(ownerUserId, clientId) {
  return {
    ownerUserId,
    clientId,
    projectId: 10,
    type: "check_in",
    latitude: 1,
    longitude: 2,
    accuracy: null,
    selfieUri: `file:///queue-test/${clientId}.jpg`,
    capturedAt: Number(clientId.replace(/\D/g, "")) || 1,
    attempts: 0,
    lastAttemptAt: 0,
  };
}

test("mobile attendance queue serializes flushes and never sends another owner's item", async () => {
  const runtime = {
    storage: new Map(),
    sent: [],
    send: async () => ({}),
  };
  runtime.storage.set("attendance_offline_queue_v1", JSON.stringify([
    queueItem(1, "item-1"),
    queueItem(2, "item-2"),
    queueItem(1, "item-3"),
  ]));
  globalThis.__mobileQueueTest = runtime;
  const queue = await importBundled("artifacts/mobile/lib/offlineQueue.ts", queueMocks);

  const [first, overlapping] = await Promise.all([
    queue.flushQueue(1),
    queue.flushQueue(1),
  ]);

  assert.equal(first.sent, 2);
  assert.equal(overlapping.sent, 0);
  assert.deepEqual(runtime.sent.map((item) => item.clientId), ["item-1", "item-3"]);
  assert.deepEqual((await queue.listQueue(2)).map((item) => item.clientId), ["item-2"]);
});

test("mobile attendance queue stops when the active account changes and quarantines legacy items", async () => {
  let currentOwner = 1;
  const runtime = {
    storage: new Map(),
    sent: [],
    send: async () => { currentOwner = 2; },
  };
  const legacy = { ...queueItem(1, "legacy") };
  delete legacy.ownerUserId;
  runtime.storage.set("attendance_offline_queue_v1", JSON.stringify([
    legacy,
    queueItem(1, "item-1"),
    queueItem(1, "item-2"),
    queueItem(2, "item-3"),
  ]));
  globalThis.__mobileQueueTest = runtime;
  const queue = await importBundled("artifacts/mobile/lib/offlineQueue.ts", queueMocks);

  const result = await queue.flushQueue(1, () => currentOwner === 1);

  assert.equal(result.sent, 1);
  assert.deepEqual(runtime.sent.map((item) => item.clientId), ["item-1"]);
  assert.deepEqual((await queue.listQueue(1)).map((item) => item.clientId), ["item-2"]);
  const quarantined = JSON.parse(runtime.storage.get("attendance_offline_queue_quarantine_v1"));
  assert.deepEqual(quarantined.map((item) => item.clientId), ["legacy"]);
});