---
name: Web manual-fetch rolling-session renewal
description: Why every hand-rolled authFetch in the construction-supervision web app must run processFetchResponse, or active users get intermittently logged out.
---

# Web manual-fetch rolling-session renewal

The API server renews the JWT in place: when a presented token has < half its lifetime left it signs a fresh one and returns it in the `X-Renewed-Token` response header (no separate refresh token). Any client request path that does not read+persist that header lets the session hard-expire at the original TTL; the next authenticated call then 401s and bounces the user to `/login`.

**Rule:** every hand-rolled `authFetch`/`authFetchJson` helper in `artifacts/construction-supervision` must `await processFetchResponse(response)` (exported from `@workspace/api-client-react`) after the raw `fetch` and before returning/parsing. That helper runs BOTH the token saver (persists `X-Renewed-Token`) AND the centralized 401 handler (`setUnauthorizedHandler` → clear creds + redirect). Orval-generated hooks already go through `customFetch`, which does this internally — only the manual fetch helpers are at risk.

**Why:** pages with a raw-fetch helper (companies, users, audit-log, reports, activities, attendance, extensions, suspensions, forms, project-members) ignored the header, so a daily user browsing those pages was silently logged out — symptom: "ينقلني احيانا ويقوم بتسجيل الخروج" (sometimes redirects me and logs me out). "Sometimes" because whether the token got renewed depended on hitting a customFetch path recently.

**How to apply:** when adding/reviewing any new manual `fetch` in the web app, confirm it calls `processFetchResponse`. The reference pattern lives in `attendance-quick-actions.tsx` / `offline-attendance.ts` / `projects/[id].tsx`. `projects/index.tsx` does the equivalent renewal+401 inline (acceptable alternative). This is the web twin of the mobile rolling-session rule — see `mobile-rolling-session.md`.
