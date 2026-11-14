---
name: Historical progress loading
description: Keep historical progress backfill reads out of routine project-page loads.
---

Load historical backfill state only when a manager opens the manual history settings. The automatic preview is already a deliberate user action and should not require a preliminary read.

**Why:** The owner confirmed that deferring the page-load request fixed that load issue, then reported a production-wide outage when either setup action was pressed. Production telemetry showed broad API kills but did not attribute them to these routes.

**How to apply:** Keep history scans off routine project-page loads, and treat manual/automatic setup requests as potentially expensive until their production cost is verified. Refresh the batch list after save or revert as needed; do not infer that deferring the initial read makes the setup operation itself safe for large histories.
