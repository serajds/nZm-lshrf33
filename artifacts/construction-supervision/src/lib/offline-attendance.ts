/**
 * Offline-first attendance queue.
 *
 * When the device is offline (or the request fails for transient network
 * reasons), the check-in/check-out request — including the selfie blob —
 * is persisted in IndexedDB and re-sent later. The backend uses the
 * `clientId` UUID stored with each entry as an idempotency key, so
 * re-sending the same queued entry never creates a duplicate record.
 */

const DB_NAME = "attendance-offline";
const STORE = "queue";
const DB_VERSION = 1;

import { processFetchResponse } from "@workspace/api-client-react";

export interface QueuedAttendance {
  /** UUID v4 generated client-side; doubles as idempotency key + queue PK. */
  clientId: string;
  projectId: number;
  type: "check_in" | "check_out";
  latitude: number;
  longitude: number;
  accuracy: number | null;
  selfie: Blob;
  selfieFilename: string;
  /** ms epoch — the moment the user actually tapped the button. */
  capturedAt: number;
  /** Number of failed flush attempts; used only for debugging / UI. */
  attempts: number;
  /** ms epoch of last attempt, or 0. */
  lastAttemptAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "clientId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store))
      .then((r) => { result = r; })
      .catch(reject);
    tx.oncomplete = () => resolve(result!);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Generate a v4 UUID. Falls back to a manual generator on very old browsers. */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function enqueueAttendance(entry: Omit<QueuedAttendance, "attempts" | "lastAttemptAt">): Promise<void> {
  await withStore("readwrite", (s) => reqAsPromise(s.put({ ...entry, attempts: 0, lastAttemptAt: 0 })));
  notifyListeners();
}

export async function listQueue(): Promise<QueuedAttendance[]> {
  const all = await withStore("readonly", (s) => reqAsPromise(s.getAll() as IDBRequest<QueuedAttendance[]>));
  // Stable order: oldest first, so we flush in capture order.
  return all.sort((a, b) => a.capturedAt - b.capturedAt);
}

export async function queueCount(): Promise<number> {
  return withStore("readonly", (s) => reqAsPromise(s.count()));
}

async function removeFromQueue(clientId: string): Promise<void> {
  await withStore("readwrite", (s) => reqAsPromise(s.delete(clientId)));
}

async function bumpAttempt(clientId: string): Promise<void> {
  await withStore("readwrite", async (s) => {
    const cur = await reqAsPromise(s.get(clientId) as IDBRequest<QueuedAttendance | undefined>);
    if (!cur) return;
    cur.attempts += 1;
    cur.lastAttemptAt = Date.now();
    await reqAsPromise(s.put(cur));
  });
}

// ---------------------------------------------------------------------------
// Network send + flush
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Encode a Blob as bare base64 (no data: prefix), chunked to avoid blowing
 *  the call stack on large images. */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type SendOutcome =
  | { kind: "ok"; record: unknown; offline: false }
  | { kind: "queued"; reason: "offline" | "network-error" }
  | { kind: "error"; status: number; message: string };

/**
 * Send a single check-in/out. On network failure (or `navigator.onLine`
 * being false), the entry is enqueued and a "queued" outcome is returned.
 * On HTTP 4xx/5xx the server is reachable but rejected the request — the
 * caller should surface the error and NOT re-queue it.
 */
export async function sendOrQueue(entry: Omit<QueuedAttendance, "attempts" | "lastAttemptAt">): Promise<SendOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    await enqueueAttendance(entry);
    return { kind: "queued", reason: "offline" };
  }

  // Send the selfie as base64 inside a JSON body with Content-Type: text/plain.
  // This bypasses Replit's Autoscale edge CSRF check, which can reject a bare
  // multipart POST whose Origin/Referer were stripped (notably when the PWA
  // service worker replays an offline-queued upload) — returning an HTML 403
  // that never reaches our server. The backend parses text/plain bodies as JSON.
  let selfieBase64: string;
  try {
    selfieBase64 = await blobToBase64(entry.selfie);
  } catch {
    // The stored selfie blob couldn't be read — keep the entry queued so the
    // user can retry rather than silently dropping the check-in.
    await enqueueAttendance(entry);
    return { kind: "queued", reason: "network-error" };
  }

  const body = JSON.stringify({
    latitude: entry.latitude,
    longitude: entry.longitude,
    accuracy: entry.accuracy != null && Number.isFinite(entry.accuracy) ? entry.accuracy : undefined,
    clientId: entry.clientId,
    selfieBase64,
  });

  const url = `${API_BASE}/attendance/projects/${entry.projectId}/${entry.type === "check_in" ? "check-in" : "check-out"}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body,
      headers: { ...authHeader(), "Content-Type": "text/plain" },
    });
  } catch {
    // Network unreachable / DNS / TLS error / aborted by browser offline.
    await enqueueAttendance(entry);
    return { kind: "queued", reason: "network-error" };
  }

  await processFetchResponse(response);

  if (response.ok) {
    const record = await response.json().catch(() => ({}));
    return { kind: "ok", record, offline: false };
  }

  // Reachable but server-side error. Surface to caller — do NOT queue,
  // because re-sending will just produce the same error. Only trust a JSON
  // { error } body; never echo a raw proxy/edge HTML page back to the user.
  let message = "";
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    if (body?.error) message = String(body.error);
  } catch { /* not json — likely an edge/proxy error page; ignore the body */ }
  if (!message) message = `تعذّر إتمام العملية (${response.status}).`;
  return { kind: "error", status: response.status, message };
}

let flushing = false;

export interface FlushResult {
  attempted: number;
  succeeded: number;
  /** Entries kept in the queue because the network is still failing. */
  stillPending: number;
  /** Entries dropped because the server returned a permanent error. */
  dropped: number;
}

/**
 * Try to drain the queue. Safe to call frequently — a guard prevents
 * concurrent flushes. Returns counts for any caller that wants to surface
 * progress in the UI.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { attempted: 0, succeeded: 0, stillPending: await queueCount(), dropped: 0 };
  flushing = true;
  let succeeded = 0;
  let attempted = 0;
  let dropped = 0;
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { attempted: 0, succeeded: 0, stillPending: await queueCount(), dropped: 0 };
    }
    if (!localStorage.getItem("auth_token")) {
      // Not logged in — keep entries until the user signs back in.
      return { attempted: 0, succeeded: 0, stillPending: await queueCount(), dropped: 0 };
    }
    const items = await listQueue();
    for (const item of items) {
      attempted += 1;
      const outcome = await sendOrQueue(item);
      if (outcome.kind === "ok") {
        await removeFromQueue(item.clientId);
        succeeded += 1;
      } else if (outcome.kind === "queued") {
        // Still offline / network keeps failing — stop trying for now.
        await bumpAttempt(item.clientId);
        break;
      } else {
        // Permanent server rejection. Drop the entry so the queue does
        // not stay stuck forever, but surface a console warning.
        // eslint-disable-next-line no-console
        console.warn("Dropping queued attendance after server error:", outcome.status, outcome.message, item);
        await removeFromQueue(item.clientId);
        dropped += 1;
      }
    }
    return { attempted, succeeded, stillPending: await queueCount(), dropped };
  } finally {
    flushing = false;
    notifyListeners();
  }
}

// ---------------------------------------------------------------------------
// Subscription model so React components can re-render on queue changes
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners() {
  listeners.forEach((l) => {
    try { l(); } catch { /* swallow */ }
  });
}

export function subscribeQueue(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// ---------------------------------------------------------------------------
// Auto-flush hooks (idempotent — safe to import many times)
// ---------------------------------------------------------------------------

let autoFlushInstalled = false;
export function installAutoFlush(): void {
  if (autoFlushInstalled || typeof window === "undefined") return;
  autoFlushInstalled = true;

  // Try once at startup (catches the case where the device started offline
  // and the user is now back online before they re-open the app).
  flushQueue().catch(() => { /* swallow */ });

  window.addEventListener("online", () => {
    flushQueue().catch(() => { /* swallow */ });
  });

  // Periodic safety net for cases where the browser does not fire `online`
  // reliably (some mobile browsers).
  setInterval(() => {
    if (navigator.onLine) flushQueue().catch(() => { /* swallow */ });
  }, 60_000);
}
