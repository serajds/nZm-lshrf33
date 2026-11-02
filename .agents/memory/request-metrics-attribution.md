---
name: Request metrics across pooled callbacks
description: Accurate per-request PostgreSQL metrics need callback context binding, not just AsyncLocalStorage.
---

Bind pooled connection callbacks to the requesting async context before counting queries or connection waits.

**Why:** PostgreSQL can satisfy a queued acquisition while releasing a connection from a different request. Without callback binding, concurrent measurements attributed SQL to the releasing request, undercounting one request and overcounting another even though both returned correct data.

**How to apply:** Keep a regression test that deliberately fulfills acquisitions from a different request context. Treat summed query duration and summed acquisition wait as concurrent totals, not wall-clock request duration; never add those totals together to claim page latency.

Internal development PostgreSQL can use a single-label service hostname and not support TLS. Cloud database hosts still require full certificate and hostname verification; never retry a failed cloud TLS connection without verification.

**Why:** Applying the cloud TLS setting to every non-localhost hostname broke the internal development service.

**How to apply:** Distinguish the internal transport from public cloud connections without printing credentials, and retain custom CA configuration when enforcing full verification.
