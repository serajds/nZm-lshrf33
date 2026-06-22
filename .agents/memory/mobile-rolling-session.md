---
name: Mobile rolling-session token handling
description: Why the Expo mobile client must mirror the web custom-fetch rolling-session pipeline, and the token-aware rule that prevents stale-response races.
---

# Mobile rolling-session token handling

The API server (`artifacts/api-server/src/middlewares/auth.ts`) issues a 7-day JWT and renews it in place: when a presented token has less than half its lifetime left, it signs a fresh one and returns it in the `X-Renewed-Token` response header. There is no separate refresh token.

**Rule:** every client must read `X-Renewed-Token` on every response and persist it, or active users get hard-logged-out at the original TTL. The web client does this in `lib/api-client-react/src/custom-fetch.ts` (saver + unauthorized handler). The Expo mobile client has its OWN fetch layer (`artifacts/mobile/lib/api.ts`) and must replicate the same pipeline independently — it does not share custom-fetch.

**Why:** mobile originally ignored the header entirely, so tokens expired after 7 days even for daily users → "رمز الدخول غير صالح أو منتهي الصلاحية". Any new mobile request path (JSON, multipart upload, offline-queue flush) must run the renewal/401 pipeline or it silently reintroduces the expiry bug.

**Token-aware guard (critical):** renewal-save and 401-logout must only fire when the bearer token that was sent with THAT request still equals the current token at response time. Without this, a stale in-flight request (old token) resolving after re-login can overwrite the fresh token or force an erroneous logout, and a login call (no session token) returning 401 for bad credentials would wrongly trigger the "session expired" flow.

**How to apply:** capture the token used per request and pass it to the response processor; compare against the live token getter before acting. Offline-queue flush must treat 401 as "keep queued + stop flushing" (re-auth already triggered centrally), never as a permanent drop.
