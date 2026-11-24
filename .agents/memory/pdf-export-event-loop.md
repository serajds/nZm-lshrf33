---
name: PDF export event-loop fairness
description: Keep synchronous PDF rendering from delaying unrelated API requests during photo-heavy exports.
---

Rule: Preserve periodic event-loop yields while drawing large activity snapshots and report photos in the server-side PDF exporter.

**Why:** In isolated mixed image-load tests, export rendering coincided with client p95 regressions for unrelated API routes even when their measured route and database times were low. Adding bounded yields made two consecutive runs pass without relaxing the existing p95 threshold.

**How to apply:** When changing PDF rendering loops, retain bounded yields between rows and image batches, then verify PDF validity and mixed-load p95.
