---
name: Historical progress loading
description: Keep historical progress backfill reads out of routine project-page loads.
---

Load historical backfill state only when a manager opens the manual history settings. The automatic preview is already a deliberate user action and should not require a preliminary read.

**Why:** The project owner confirmed that deferring the automatic page-load request resolved the observed system load problem.

**How to apply:** Keep history scans tied to explicit history-management actions. Refresh the batch list after save or revert as needed, but do not re-enable the scan on project-detail mount.
