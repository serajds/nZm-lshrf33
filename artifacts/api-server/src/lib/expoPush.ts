/**
 * Expo Push notification dispatcher.
 *
 * Tokens are stored per-user in the `expo_push_tokens` table. We POST to
 * Expo's public push API (no API key required for ≤100 messages/sec).
 * Stale tokens (DeviceNotRegistered) are pruned automatically.
 */
import { db } from "@workspace/db";
import { expoPushTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** A short string used to override an earlier notification with the same id. */
  channelId?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

async function postToExpo(messages: Array<Record<string, unknown>>): Promise<ExpoTicket[]> {
  if (messages.length === 0) return [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.warn("[expo-push] HTTP", res.status, await res.text().catch(() => ""));
      return [];
    }
    const json = (await res.json()) as { data?: ExpoTicket[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch (err) {
    console.warn("[expo-push] dispatch error:", err);
    return [];
  }
}

export async function sendExpoPushToUser(userId: number, payload: ExpoPushPayload): Promise<void> {
  const rows = await db.select({ id: expoPushTokensTable.id, token: expoPushTokensTable.token })
    .from(expoPushTokensTable)
    .where(eq(expoPushTokensTable.userId, userId));
  if (rows.length === 0) return;

  const messages = rows.map(r => ({
    to: r.token,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    channelId: payload.channelId ?? "default",
    priority: "high",
  }));

  const tickets = await postToExpo(messages);

  // Best-effort cleanup of dead tokens.
  const goneIds: number[] = [];
  tickets.forEach((t, i) => {
    if (t.status === "error" && t.details?.error === "DeviceNotRegistered") {
      goneIds.push(rows[i].id);
    }
  });
  if (goneIds.length > 0) {
    await db.delete(expoPushTokensTable).where(inArray(expoPushTokensTable.id, goneIds)).catch(() => {});
  }
}

export async function sendExpoPushToUsers(userIds: number[], payload: ExpoPushPayload): Promise<void> {
  const unique = Array.from(new Set(userIds));
  await Promise.all(unique.map(id => sendExpoPushToUser(id, payload)));
}
