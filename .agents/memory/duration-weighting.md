---
name: Duration weighting and frozen reports
description: Decision on live activity weights versus persisted custom weights and report history
---

Live Planned and Actual must use the same inclusive UTC calendar-day duration per activity, with a one-day fallback for missing or invalid schedules. The persisted custom `weight` is retained for a future selectable weighting method, not overwritten with duration or inferred as an override merely because it differs from 1. Old report snapshots retain their saved weights; new reports freeze the effective weight when captured.

**Why:** Existing rows default to 1, so there is no reliable way to distinguish an intentional custom weight of 1 from a default. Overwriting the field or reinterpreting old snapshots would silently change historical reports and interfere with linked/generated activities.

**How to apply:** In live aggregations use effective duration weighting for both planned and actual; use stored weights only for an explicitly selected custom mode or previously saved report rows. If introducing equal/custom/cost controls later, make the weighting method explicit rather than guessing intent from stored values.