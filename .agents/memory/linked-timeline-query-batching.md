---
name: Linked timeline query batching
description: Performance and privacy constraints for project timelines that display activities linked to source projects.
---

Resolve the linked source-group graph and source-project visibility in batched, request-scoped reads; do not issue an independent query chain per imported activity or share protected results across users.

**Why:** Production telemetry showed severe pool waits and slow timeline/summary requests with linked projects. Per-item queries can overwhelm the small database pool even when request volume is modest.

**How to apply:** Preserve current-role and tab-visibility checks while batching source groups and permission data. Keep caches limited to a single request and retain cycle handling for linked-source graphs.
