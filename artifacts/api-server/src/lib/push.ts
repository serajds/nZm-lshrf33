/**
 * Web Push notification dispatcher.
 *
 * Subscriptions are stored in the `push_subscriptions` table (one row per
 * browser/device per user). `sendPushToUser(userId, payload)` fans out to
 * every subscription for that user. Stale endpoints (HTTP 404 / 410) are
 * pruned automatically so we don't keep retrying gone devices.
 *
 * Dispatch is fire-and-forget: callers SHOULD NOT await it inside the main
 * request handler — use `.catch(...)` to swallow errors so a notification
 * problem never bubbles up as a failed user-facing request.
 */
import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq, inArray, or, and, ne } from "drizzle-orm";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:notify@construction-supervision.local";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    // Soft-fail: in environments without VAPID keys (e.g. early local dev),
    // we just log once and treat all dispatches as no-ops rather than crashing.
    // eslint-disable-next-line no-console
    console.warn("[push] VAPID keys not configured; web push is disabled.");
    return false;
  }
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string {
  return PUBLIC_KEY;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path inside the app to open when the user taps the notification (e.g. `/projects/8/attendance`). */
  url?: string;
  /** Notification.tag — replaces an existing notification with the same tag. */
  tag?: string;
  /** Free-form metadata available to the SW handler. */
  data?: Record<string, unknown>;
}

async function dispatchToSubscription(
  sub: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<"sent" | "gone" | "error"> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    // 404 = subscription not found, 410 = gone — endpoint is permanently dead.
    if (status === 404 || status === 410) return "gone";
    // eslint-disable-next-line no-console
    console.warn("[push] dispatch error:", status, err);
    return "error";
  }
}

/** Send a push to every subscription belonging to a single user. */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await db
    .select({ id: pushSubscriptionsTable.id, endpoint: pushSubscriptionsTable.endpoint, p256dh: pushSubscriptionsTable.p256dh, auth: pushSubscriptionsTable.auth })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  if (subs.length === 0) return;

  const goneIds: number[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      const r = await dispatchToSubscription(sub, payload);
      if (r === "gone") goneIds.push(sub.id);
    }),
  );

  if (goneIds.length > 0) {
    await db.delete(pushSubscriptionsTable).where(inArray(pushSubscriptionsTable.id, goneIds));
  }
}

/** Send the same push to many users (e.g. all admins). De-duplicates per user. */
export async function sendPushToUsers(userIds: number[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const unique = Array.from(new Set(userIds));
  await Promise.all(unique.map((id) => sendPushToUser(id, payload)));
}

/**
 * Find every user who supervises a project — global admins + the project's
 * project-managers. Used to notify the people who actually need to know
 * when someone checks in, when a suspension is filed, etc.
 *
 * Pass `excludeUserId` to avoid notifying the actor themselves.
 */
export async function getProjectSupervisorIds(projectId: number, excludeUserId?: number): Promise<number[]> {
  // Global admins
  const admins = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));

  // Project members who are managers
  const pms = await db.select({ id: projectMembersTable.userId })
    .from(projectMembersTable)
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.role, "project_manager"),
    ));

  const ids = new Set<number>();
  for (const a of admins) ids.add(a.id);
  for (const p of pms) ids.add(p.id);
  if (excludeUserId !== undefined) ids.delete(excludeUserId);
  return Array.from(ids);
}

// Re-export bits used inline above so other modules don't need to also import drizzle-orm helpers.
export { or, ne };
