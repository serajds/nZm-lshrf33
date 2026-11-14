---
name: Legacy startup maintenance
description: Why legacy upload backfills and URL normalization should not run on every API process start.
---

Run legacy upload backfills and URL normalization as an explicit maintenance command rather than automatically at every API startup.

**Why:** Production restarts repeatedly scanned 102 local uploads while transferring zero files, and ran URL normalization on each boot as API memory approached its configured limit. Telemetry did not prove these jobs caused the process kills, so treat them as avoidable startup work, not a confirmed root cause.

**How to apply:** Keep maintenance callable for a controlled one-off run. Before publishing a change that removes startup execution, verify whether legacy data still needs migration; do not run the migration against production without explicit authorization.
