import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import { getVapidPublicKey } from "../lib/push";

const router: IRouter = Router();

/**
 * Public VAPID key — required by the browser to register a push subscription.
 * Behind requireAuth so unauthenticated probes can't enumerate whether push
 * is configured (the client always has a token by the time it asks).
 */
router.get("/push/vapid-public-key", requireAuth, (_req: Request, res: Response): void => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push notifications are not configured on this server" });
    return;
  }
  res.json({ publicKey: key });
});

/**
 * Register (or refresh) a push subscription for the current user.
 *
 * Concurrency: uses an atomic INSERT … ON CONFLICT (endpoint) DO UPDATE so
 * concurrent re-subscribe calls from the same device can never trip the
 * unique constraint and 500.
 *
 * Ownership: if the endpoint already exists under a *different* user, we
 * still re-assign it to the current user — this is correct behaviour because
 * a single browser can only have ONE active subscription per origin, and
 * ownership transfer happens naturally when a shared device is signed into
 * by a new account. The previous owner is no longer the one driving that
 * browser, so they should stop receiving notifications on it.
 */
router.post("/push/subscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { endpoint, keys, userAgent } = req.body ?? {};

  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    res.status(400).json({ error: "endpoint مطلوب" });
    return;
  }
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    res.status(400).json({ error: "مفاتيح الاشتراك ناقصة" });
    return;
  }

  const ua = typeof userAgent === "string" ? userAgent.slice(0, 255) : null;

  // Atomic upsert — never races against itself, never violates the unique
  // index. Returns `inserted=true` only on a fresh INSERT (xmax=0 trick).
  const result = await db.execute(sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (${userId}, ${endpoint}, ${String(keys.p256dh)}, ${String(keys.auth)}, ${ua})
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      last_used_at = now()
    RETURNING (xmax = 0) AS inserted
  `);

  const rows = (result as unknown as { rows?: Array<{ inserted: boolean }> }).rows ?? (result as unknown as Array<{ inserted: boolean }>);
  const inserted = Array.isArray(rows) && rows[0]?.inserted === true;

  res.status(inserted ? 201 : 200).json({ ok: true, refreshed: !inserted });
});

/**
 * Remove a subscription by endpoint (called when the user opts out, or
 * the SW detects its subscription was revoked).
 */
router.post("/push/unsubscribe", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== "string") {
    res.status(400).json({ error: "endpoint مطلوب" });
    return;
  }
  await db.delete(pushSubscriptionsTable)
    .where(and(
      eq(pushSubscriptionsTable.endpoint, endpoint),
      eq(pushSubscriptionsTable.userId, userId),
    ));
  res.json({ ok: true });
});

export default router;
