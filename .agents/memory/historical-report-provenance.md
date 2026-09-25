---
name: Historical report provenance
description: How to represent progress for reports dated before their activity values were captured
---

Historical planned progress can be calculated from a dated schedule snapshot, but historical actual progress cannot be inferred from today's activity state. Treat a backdated report's copied actual values as recorded-at-creation, not verified at the report date; avoid publishing an as-of SPI from them without evidence of their effective date.

**Why:** Entering an old report later captures the present state of work unless an independent historical actual snapshot exists. A plausible percentage is not evidence that it was true on the report date.

**How to apply:** When adding historical report views, imports, exports, or edits, preserve the manually reported percentage separately, expose provenance or an unavailable state for unverifiable actuals, and never substitute current activities for a missing historical snapshot.