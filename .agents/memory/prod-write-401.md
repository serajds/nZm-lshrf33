---
name: Production write-401 logout bug
description: Investigation state for prod PATCH/write 401s that logged users out; eliminated causes and the diagnostics/defense shipped
---

# Symptom
In production (autoscale, portal.almadaco.ly), browser write requests (PATCH) hit 401 from `requireAuth` in 1–8ms while GETs and login from the same client succeed seconds apart. Each 401 fired the unauthorized handler → logout loop ("فشل التحديث").

# Causes ELIMINATED by direct prod probing (do not re-test)
- Edge does NOT strip Authorization on writes: curl PATCH with valid JWT passes (400 "لا توجد بيانات للتحديث" on empty body).
- Origin-based CSRF blocking: PATCH with Origin set to any prod domain or evil.example.com still passes with valid token.
- Stale deployed bundle: prod asset hashes exactly match a fresh local build.
- Service worker: workbox /api rule has always been NetworkFirst (GET-only); no custom fetch handler intercepts writes.
- Mobile app: has no PATCH calls at all; failing PATCH is from web.
- JWT_SECRET matches between dev env and prod (a dev-signed token verifies in prod).
- Client code: all fetch helpers read localStorage "auth_token" fresh per call; no stale-closure or key mismatch found.

# Root cause: still UNKNOWN — diagnostics shipped
- `requireAuth` now logs `authDiag` (warn) on every 401: reason (missing-header | bad-scheme | invalid-token), method, path, origin, referer presence, content-type, sec-fetch-site, user-agent, auth header length; for invalid tokens the jsonwebtoken error name + decoded iat/exp + server now. Never the token itself.
- **How to apply:** after the user republishes and reproduces, read deployment logs filtered on `authDiag` — "missing-header" means the header is lost in transit/client; "invalid-token" + TokenExpiredError means a stale token source on the device.

# Defense shipped (shared lib custom-fetch)
- On any 401, before firing the logout handler, the client probes GET /api/auth/me with the current token via raw fetch; logout fires only if the probe also 401s. Probe network failures suppress logout. Concurrent 401s share one in-flight probe.
- **Why:** a single anomalous 401 must not destroy a valid session; genuine expiry still logs out (probe 401s too).
