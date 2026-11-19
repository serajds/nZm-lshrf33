---
name: Historical backfill gap detection
description: Detect missing historical coverage before an activity's first dated progress point.
---

An activity having any dated progress does not mean all earlier report dates are covered. When the first dated progress point comes after its actual start, allow a reviewed estimate for the earlier gap while preserving all actual snapshots and saved report anchors.

**Why:** Reports for earlier periods must not silently use today's values, and rejecting backfill merely because later history exists leaves those periods unavailable.

**How to apply:** Compare the activity's actual start date with its earliest dated progress evidence. Backfill only when the start precedes that evidence, keep actual and report-anchored dates authoritative, and clearly identify generated values as estimates.
