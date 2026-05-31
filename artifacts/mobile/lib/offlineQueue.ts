/**
 * Offline-first attendance queue (React Native).
 *
 * Mirrors the web's offline-attendance.ts but uses AsyncStorage for the
 * metadata + the local file URI returned by ImagePicker (file:// path) for
 * the selfie payload. The clientId UUID is sent to the server as the
 * idempotency key so duplicate flushes never create duplicate records.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { apiAttendanceCheck, ApiError } from "./api";

const STORAGE_KEY = "attendance_offline_queue_v1";
const QUEUE_DIR = (FileSystem.documentDirectory ?? "") + "attendance-queue/";

async function ensureQueueDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
    }
  } catch { /* ignore */ }
}

/**
 * Copy the (possibly cache-only) selfie URI into a permanent location
 * inside documentDirectory so it survives app restarts and OS cache
 * cleanup. Returns the new URI, or the original on failure.
 */
async function persistSelfie(srcUri: string, clientId: string): Promise<string> {
  if (!FileSystem.documentDirectory) return srcUri;
  if (srcUri.startsWith(QUEUE_DIR)) return srcUri;
  await ensureQueueDir();
  const dst = `${QUEUE_DIR}${clientId}.jpg`;
  try {
    await FileSystem.copyAsync({ from: srcUri, to: dst });
    return dst;
  } catch {
    return srcUri;
  }
}

async function deleteSelfie(uri: string): Promise<void> {
  if (!uri.startsWith(QUEUE_DIR)) return;
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* ignore */ }
}

export interface QueuedAttendance {
  clientId: string;
  projectId: number;
  type: "check_in" | "check_out";
  latitude: number;
  longitude: number;
  accuracy: number | null;
  selfieUri: string;
  capturedAt: number;
  attempts: number;
  lastAttemptAt: number;
}

export function newClientId(): string {
  return Crypto.randomUUID();
}

async function load(): Promise<QueuedAttendance[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function save(items: QueuedAttendance[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  notify();
}

const listeners = new Set<(count: number) => void>();
export function subscribeQueue(cb: (count: number) => void): () => void {
  listeners.add(cb);
  load().then(items => cb(items.length)).catch(() => {});
  return () => { listeners.delete(cb); };
}
function notify() {
  load().then(items => listeners.forEach(l => { try { l(items.length); } catch {} })).catch(() => {});
}

export async function enqueue(entry: Omit<QueuedAttendance, "attempts" | "lastAttemptAt">): Promise<void> {
  const persistedUri = await persistSelfie(entry.selfieUri, entry.clientId);
  const items = await load();
  items.push({ ...entry, selfieUri: persistedUri, attempts: 0, lastAttemptAt: 0 });
  await save(items);
}

export async function queueCount(): Promise<number> {
  return (await load()).length;
}

export async function listQueue(): Promise<QueuedAttendance[]> {
  return (await load()).sort((a, b) => a.capturedAt - b.capturedAt);
}

async function removeOne(clientId: string): Promise<void> {
  const items = await load();
  const removed = items.find(i => i.clientId === clientId);
  await save(items.filter(i => i.clientId !== clientId));
  if (removed) await deleteSelfie(removed.selfieUri);
}

async function bumpAttempt(clientId: string): Promise<void> {
  const items = await load();
  const idx = items.findIndex(i => i.clientId === clientId);
  if (idx < 0) return;
  items[idx].attempts += 1;
  items[idx].lastAttemptAt = Date.now();
  await save(items);
}

export type SendOutcome =
  | { kind: "ok"; offline: false }
  | { kind: "queued"; reason: "offline" | "network-error" }
  | { kind: "error"; status: number; message: string };

/**
 * Try to send immediately. On network failure (status 0), enqueue and
 * report "queued". On 4xx/5xx, surface the error and DO NOT queue (the
 * server explicitly rejected, e.g. geofence).
 */
export async function sendOrQueue(entry: Omit<QueuedAttendance, "attempts" | "lastAttemptAt">): Promise<SendOutcome> {
  try {
    await apiAttendanceCheck({
      projectId: entry.projectId,
      type: entry.type,
      selfieUri: entry.selfieUri,
      latitude: entry.latitude,
      longitude: entry.longitude,
      accuracy: entry.accuracy,
      clientId: entry.clientId,
    });
    return { kind: "ok", offline: false };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 0) {
        await enqueue(entry);
        return { kind: "queued", reason: "network-error" };
      }
      return { kind: "error", status: e.status, message: e.message };
    }
    await enqueue(entry);
    return { kind: "queued", reason: "network-error" };
  }
}

/** Try to flush all queued items. Returns counts of (sent, failed-still-queued, dropped). */
export async function flushQueue(): Promise<{ sent: number; stillQueued: number; dropped: number }> {
  const items = await listQueue();
  let sent = 0, stillQueued = 0, dropped = 0;
  for (const item of items) {
    try {
      await apiAttendanceCheck({
        projectId: item.projectId,
        type: item.type,
        selfieUri: item.selfieUri,
        latitude: item.latitude,
        longitude: item.longitude,
        accuracy: item.accuracy,
        clientId: item.clientId,
      });
      await removeOne(item.clientId);
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // Session expired: keep this item (and all remaining ones) queued and
        // stop flushing — re-auth has already been triggered centrally, so
        // continuing would just fire more doomed requests. Retry next cycle
        // after the user logs back in.
        await bumpAttempt(item.clientId);
        stillQueued += items.length - items.indexOf(item);
        break;
      }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 0) {
        // Permanent rejection (e.g. geofence) — drop it; don't loop forever.
        await removeOne(item.clientId);
        dropped++;
      } else {
        await bumpAttempt(item.clientId);
        stillQueued++;
      }
    }
  }
  return { sent, stillQueued, dropped };
}
