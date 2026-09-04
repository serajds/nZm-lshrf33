---
name: Session generations and authenticated caches
description: Why session responses must be token-bound and protected responses must never enter shared browser or service-worker caches.
---

Treat each login token as a session generation. Renewal and 401 responses may only change or clear the exact token sent with that request; login, logout, and cross-tab updates must use conditional transitions. Protected API and upload responses must be network-only and `private, no-store`.

**Why:** A deployed PWA can keep an older client and cache alive. A stale authenticated response—especially one carrying a rolling-renewal header—can otherwise overwrite a newer login, while a stale 401 can delete it. Publicly caching an authenticated file also lets the cache bypass the authorization boundary.

**How to apply:** Whenever adding a request path, capture the bearer token used and route the response through the shared session pipeline. For offline queues, bind each entry to its owner and exact flush token. Never add public/shared caching to a response that required bearer or scoped-token authorization.