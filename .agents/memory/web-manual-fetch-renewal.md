---
name: Web manual-fetch rolling-session renewal
description: Why every hand-rolled authFetch in the construction-supervision web app must run processFetchResponse, or active users get intermittently logged out.
---

# Web manual-fetch rolling-session renewal

The API server renews the JWT in place: when a presented token has < half its lifetime left it signs a fresh one and returns it in the `X-Renewed-Token` response header (no separate refresh token). Any client request path that does not read+persist that header lets the session hard-expire at the original TTL; the next authenticated call then 401s and bounces the user to `/login`.

**Rule:** every protected request in `artifacts/construction-supervision` must use `customFetch`, or capture the exact bearer token used and pass it to `processFetchResponse(response, requestToken)`. That pipeline runs both rolling renewal and confirmed-401 handling. Orval-generated hooks already use it; public/owner-link tokens must remain outside the user-session handler.

**Why:** pages with a raw-fetch helper (companies, users, audit-log, reports, activities, attendance, extensions, suspensions, forms, project-members) ignored the header, so a daily user browsing those pages was silently logged out — symptom: "ينقلني احيانا ويقوم بتسجيل الخروج" (sometimes redirects me and logs me out). "Sometimes" because whether the token got renewed depended on hitting a customFetch path recently.

**How to apply:** prefer `customFetch` for JSON and downloads. If transport requires raw fetch/XHR, preserve the request token until the response arrives and run the shared response processor before parsing. Never clear credentials for 403; a 401 only logs out after the current token is independently rejected. This is the web twin of the mobile rolling-session rule — see `mobile-rolling-session.md`.
