---
name: Checkpoint restore and API runtime
description: Why a restored API codebase can disagree with the running Development endpoint.
---

After a checkpoint restore, do not assume a rebuilt API bundle means the running API has adopted it. The Development API workflow builds once at startup and then runs Node against that bundle; a process that started before the restore can keep executing its old, in-memory code even after the bundle on disk has changed.

**Why:** A project's live summary and project-detail endpoints both returned an older progress calculation while the current source and database agreed on a different value. Restarting the existing API workflow rebuilt and loaded the restored code; both endpoints then matched the database without any data edits.

**How to apply:** After restoring checkpoints, compare live endpoint output with current source and data, and check the API process start time against the restore/build time. If the process predates the restore, restart the existing API workflow and recheck before changing formulas, data, or frontend caching.