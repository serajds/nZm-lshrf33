---
name: Excel import preview lifetime
description: Safety tradeoff for the two-step Excel import flow when the API process changes.
---

Excel import previews are short-lived and process-local. A confirm reaching another API instance or arriving after restart must fail clearly and require a fresh preview; it must not guess at the file contents or silently create duplicate groups.

**Why:** The preview and commit need the same parsed rows and user/project identity. Without durable atomic idempotency, a stateless retry after an uncertain commit could import activities twice. Failing closed is safer than attempting an unchecked replay, although it costs the user another upload.

**How to apply:** If running multiple API instances or making previews survive restarts, first introduce shared expiring preview storage with atomic claim/consume and a durable completed result. Test two-instance confirms and ambiguous post-commit responses before treating the flow as reliable across replicas.