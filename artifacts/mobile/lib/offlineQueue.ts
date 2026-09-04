/**
 * Offline-first, account-isolated attendance queue.
 *
 * Every item is permanently bound to the user who captured it. Items written
 * by older app versions have no trustworthy owner and are moved to quarantine
 * rather than risking submission under whichever account logs in next.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { apiAttendanceCheck, ApiError } from "./api";

const STORAGE_KEY = "attendance_offline_queue_v1";
const QUARANTINE_KEY = "attendance_offline_queue_quarantine_v1";
const QUEUE_DIR = (FileSystem.documentDirectory ?? "") + "attendance-queue/";

export interface QueuedAttendance {
  ownerUserId: number;
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

type NewQueuedAttendance = Omit<QueuedAttendance, "attempts" | "lastAttemptAt">;
type FlushResult = { sent: number; stillQueued: number; dropped: number };

let queueOperations: Promise<void> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperations.then(operation, operation);
  queueOperations = result.then(() => {}, () => {});
  return result;
}

async function ensureQueueDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  const info = await FileSystem.getInfoAsync(QUEUE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
}

async function persistSelfie(srcUri: string, clientId: string): Promise<string> {
  if (!FileSystem.documentDirectory || srcUri.startsWith(QUEUE_DIR)) return srcUri;
  try {
    await ensureQueueDir();
    const dst = `${QUEUE_DIR}${clientId}.jpg`;
    await FileSystem.copyAsync({ from: srcUri, to: dst });
    return dst;
  } catch {
    // The source URI may still be durable; queuing it is safer than discarding
    // a captured attendance record because the defensive copy failed.
    return srcUri;
  }
}

async function deleteSelfie(uri: string): Promise<void> {
  if (!uri.startsWith(QUEUE_DIR)) return;
  try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* best-effort cleanup */ }
}

async function readArray(key: string): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) ? value : [];
}

function hasKnownOwner(item: unknown): item is QueuedAttendance {
  if (!item || typeof item !== "object") return false;
  const owner = (item as { ownerUserId?: unknown }).ownerUserId;
  return typeof owner === "number" && Number.isFinite(owner);
}

async function loadAll(): Promise<QueuedAttendance[]> {
  const stored = await readArray(STORAGE_KEY);
  const active = stored.filter(hasKnownOwner);
  const unknownOwner = stored.filter((item) => !hasKnownOwner(item));
  if (unknownOwner.length) {
    const quarantined = await readArray(QUARANTINE_KEY);
    await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify([...quarantined, ...unknownOwner]));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  }
  return active;
}

const listeners = new Set<{ ownerUserId: number; callback: (count: number) => void }>();
function notify(items: QueuedAttendance[]): void {
  for (const listener of listeners) {
    try {
      listener.callback(items.filter((item) => item.ownerUserId === listener.ownerUserId).length);
    } catch { /* one listener must not break queue writes */ }
  }
}

async function saveAll(items: QueuedAttendance[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  notify(items);
}

export function newClientId(): string {
  return Crypto.randomUUID();
}

export function subscribeQueue(ownerUserId: number, callback: (count: number) => void): () => void {
  const listener = { ownerUserId, callback };
  listeners.add(listener);
  void serialized(async () => {
    const items = await loadAll();
    callback(items.filter((item) => item.ownerUserId === ownerUserId).length);
  }).catch(() => {});
  return () => { listeners.delete(listener); };
}

export function enqueue(entry: NewQueuedAttendance): Promise<void> {
  return serialized(async () => {
    const persistedUri = await persistSelfie(entry.selfieUri, entry.clientId);
    const items = await loadAll();
    items.push({ ...entry, selfieUri: persistedUri, attempts: 0, lastAttemptAt: 0 });
    await saveAll(items);
  });
}

export function queueCount(ownerUserId: number): Promise<number> {
  return serialized(async () => (await loadAll()).filter((item) => item.ownerUserId === ownerUserId).length);
}

export function listQueue(ownerUserId: number): Promise<QueuedAttendance[]> {
  return serialized(async () => (await loadAll())
    .filter((item) => item.ownerUserId === ownerUserId)
    .sort((a, b) => a.capturedAt - b.capturedAt));
}

export type SendOutcome =
  | { kind: "ok"; offline: false }
  | { kind: "queued"; reason: "network-error" }
  | { kind: "error"; status: number; message: string };

export async function sendOrQueue(entry: NewQueuedAttendance): Promise<SendOutcome> {
  try {
    await apiAttendanceCheck(entry);
    return { kind: "ok", offline: false };
  } catch (error) {
    if (error instanceof ApiError && error.status !== 0) {
      return { kind: "error", status: error.status, message: error.message };
    }
    await enqueue(entry);
    return { kind: "queued", reason: "network-error" };
  }
}

/**
 * Flush only one owner's records. The current-owner predicate prevents an
 * account switch midway through a flush from sending the old owner's next
 * record with the new account's bearer token.
 */
export function flushQueue(
  ownerUserId: number,
  isOwnerCurrent: () => boolean = () => true,
): Promise<FlushResult> {
  return serialized(async () => {
    let all = await loadAll();
    const items = all
      .filter((item) => item.ownerUserId === ownerUserId)
      .sort((a, b) => a.capturedAt - b.capturedAt);
    let sent = 0;
    let dropped = 0;

    for (const item of items) {
      if (!isOwnerCurrent()) break;
      try {
        await apiAttendanceCheck(item);
        all = all.filter((candidate) => candidate.clientId !== item.clientId);
        await saveAll(all);
        await deleteSelfie(item.selfieUri);
        sent++;
      } catch (error) {
        const index = all.findIndex((candidate) => candidate.clientId === item.clientId);
        if (error instanceof ApiError && error.status === 401) {
          if (index >= 0) {
            all[index] = { ...all[index], attempts: all[index].attempts + 1, lastAttemptAt: Date.now() };
            await saveAll(all);
          }
          break;
        }
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
          all = all.filter((candidate) => candidate.clientId !== item.clientId);
          await saveAll(all);
          await deleteSelfie(item.selfieUri);
          dropped++;
        } else if (index >= 0) {
          all[index] = { ...all[index], attempts: all[index].attempts + 1, lastAttemptAt: Date.now() };
          await saveAll(all);
        }
      }
    }

    return {
      sent,
      dropped,
      stillQueued: all.filter((item) => item.ownerUserId === ownerUserId).length,
    };
  });
}