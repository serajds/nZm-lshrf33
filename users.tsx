/**
 * Web Push subscription client.
 *
 * Handles VAPID public-key fetching, subscription/unsubscription against
 * our backend, and reads back the current subscription state on demand.
 *
 * The browser identifies a subscription by its `endpoint` URL — the same
 * value we use as the unique key on the server. Re-subscribing on a device
 * that already has a subscription is idempotent (the server upserts).
 */

import { customFetch, ApiError } from "@workspace/api-client-react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function arrayBufferToBase64(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

async function getSWRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // Wait for the workbox-managed SW to be ready.
  return await navigator.serviceWorker.ready;
}

/** Returns the current PushSubscription if one exists. */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getSWRegistration();
  if (!reg) return null;
  return await reg.pushManager.getSubscription();
}

interface VapidKeyResponse { publicKey: string }

async function fetchVapidKey(): Promise<string> {
  try {
    const data = await customFetch<VapidKeyResponse>("/push/vapid-public-key");
    if (!data?.publicKey) throw new Error("VAPID public key missing in response");
    return data.publicKey;
  } catch (e) {
    if (e instanceof ApiError) throw new Error("VAPID public key not available (server returned " + e.status + ")");
    throw e;
  }
}

function serializeSubscription(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: arrayBufferToBase64(sub.getKey("p256dh")),
      auth: arrayBufferToBase64(sub.getKey("auth")),
    },
  };
}

/**
 * Ask the user for permission, register a push subscription, and persist it
 * to the server. Idempotent — calling again on a device that's already
 * subscribed will refresh the server-side row.
 *
 * Returns `true` if the user is now subscribed, `false` if they denied.
 */
export async function enablePushNotifications(): Promise<boolean> {
  if (!isPushSupported()) throw new Error("الإشعارات غير مدعومة في هذا المتصفح");

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;

  const reg = await getSWRegistration();
  if (!reg) throw new Error("Service worker غير جاهز");

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = await fetchVapidKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
    });
  }

  await customFetch("/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...serializeSubscription(sub),
      userAgent: navigator.userAgent,
    }),
  });
  return true;
}

/** Unsubscribe locally + tell the server to forget our endpoint. */
export async function disablePushNotifications(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* ignore — we still want to delete on server */
  }
  await customFetch("/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => { /* best-effort */ });
}
