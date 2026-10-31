---
name: Session generations and authenticated caches
description: Why session responses must be token-bound and protected responses must never enter shared browser or service-worker caches.
---

Treat each request token as a credential generation: renewal and 401 responses may only change or clear the exact token sent with that request. Track login-session lineage separately for cached identity: a rolling renewal retains the lineage, while login/replacement/logout changes it. Protected API and upload responses must be network-only and `private, no-store`.

**Why:** A deployed PWA can keep an older client and cache alive. A stale authenticated response—especially one carrying a rolling-renewal header—can otherwise overwrite a newer login, while a stale 401 can delete it. Publicly caching an authenticated file also lets the cache bypass the authorization boundary.

**How to apply:** Whenever adding a request path, capture the bearer token used and route the response through the shared session pipeline. For offline queues, bind each entry to its owner and exact flush token. Never add public/shared caching to a response that required bearer or scoped-token authorization.

Preserve authenticated page caches during same-lineage renewal, but clear them for account replacement or logout. Cached users must be lineage-bound, and late responses/effects from another lineage must not repopulate the new account's identity. Lineage is only a client cache-isolation mechanism, never an authorization source.

**Why:** Treating every renewed token as an account switch cleared the whole application cache during ordinary use and could interrupt open forms. Preserving all token changes indiscriminately would instead expose the prior account's cached data.

**How to apply:** Keep response-token compare-and-swap protection even when the cache survives renewal. Scope user queries to the login lineage; use the server's current-user response and current database role for authorization.

An unavailable network or timed-out auth check is not evidence of an expired session. Keep the credential, offer retry without redirecting to login, and only end the session after rejection of the current token is confirmed.

**Why:** The initial user query could fail on a connection error and compute “not authenticated” despite still holding the token.

Print-window HTML cannot attach the application's bearer header to image requests. Resolve protected images, including company logos, through the session-aware loader before writing the final report content; a loading window may open immediately.

**Why:** Report photos used authenticated loading but company logos used direct URLs, causing logos to disappear in the issued report.

**How to apply:** Embed resolved images in print HTML without prefixing data URLs; keep upload authorization intact and surface failed required logo loads instead of silently omitting them.