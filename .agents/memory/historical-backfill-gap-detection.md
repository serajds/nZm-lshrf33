---
name: Historical backfill gap detection
description: Detect missing historical coverage before an activity's first dated progress point.
---

An activity having any dated progress does not mean all earlier report dates are covered. When the first dated progress point comes after its actual start, allow a reviewed estimate for the earlier gap while preserving all actual snapshots and saved report anchors.

**Why:** Reports for earlier periods must not silently use today's values, and rejecting backfill merely because later history exists leaves those periods unavailable.

**How to apply:** Compare the activity's actual start date with its earliest dated progress evidence. Backfill only when the start precedes that evidence, keep actual and report-anchored dates authoritative, and clearly identify generated values as estimates.

In automatic mode, a future actual-start date conflicts with progress already recorded by the report cutoff. Do not block the preview or write that future date into estimates; ignore it only for the estimate, start from the reconstruction period's zero baseline, and disclose the assumption. Estimated linked-source history must also propagate estimated provenance to parent reports and must not supply historical SPI.

**Why:** Development data can contain positive progress captured before a future actual-start date; strict date ordering made automatic setup impossible, while silently treating linked estimates as actual would misstate report certainty.

**How to apply:** Keep manual mode strict. In automatic previews, preserve actual snapshots, report the future-date fallback as a warning, and label any parent aggregate using estimated sources as estimated with planned comparisons unavailable.
