---
name: Historical report provenance
description: How to represent progress for reports dated before their activity values were captured
---

Historical planned progress can be calculated from a dated schedule snapshot, but historical actual progress cannot be inferred from today's activity state. Treat a backdated report's copied actual values as recorded-at-creation, not verified at the report date; avoid publishing an as-of SPI from them without evidence of their effective date.

**Why:** Entering an old report later captures the present state of work unless an independent historical actual snapshot exists. A plausible percentage is not evidence that it was true on the report date.

**How to apply:** When adding historical report views, imports, exports, or edits, preserve the manually reported percentage separately, expose provenance or an unavailable state for unverifiable actuals, and never substitute current activities for a missing historical snapshot.

For new reports, “نسبة الإنجاز حتى تاريخه” means cumulative progress through the end of the report period in Libya's calendar day, not the issue date and not just progress earned within that period. Use the weights and activity membership recorded for that date, including zero-progress activities and historical linked sources.

**Why:** The user explicitly requested period-based reporting and approved implementing it in Development only, with existing saved reports preserved.

**How to apply:** Keep historical reports frozen when live progress or weights change. Recording history now does not establish earlier actuals: periods before coverage need explicit documented manual input or an unavailable state. Record-time history is not permission to infer when earlier work physically occurred.

For this report-calculation work, the user said: “أنا لا اريد تغيير بيانات وانما طريقة حساب النسبة في التقرير”. Using the previous progress-saving mechanism means reading it as a calculation source, not restoring or merging audit data.

**Why:** The user corrected an unsolicited backup-restoration direction; the requested scope is the report calculation.

**How to apply:** Keep existing project data and reports unchanged. Discuss or implement the calculation against available history without initiating audit imports, restoration previews or data reconciliation unless separately requested.

The user approved the simpler report-level approach: choose the reporting period, confirm an editable cumulative percentage through its end (suggest from sufficient history, otherwise require manual input), and specify the work actually performed during that period. AI wording uses these approved report inputs, not today's project percentage or activity update timestamps as evidence of execution.

**Why:** The user requested a less complicated solution than entering an effective progress date for each activity and confirmed this explanation with “رائع”.

**How to apply:** Keep the approved percentage and narrative scoped to the report and frozen after saving; do not change live project progress or existing reports. A manually approved aggregate does not establish historical progress for individual activities. Never feed current activity values or update timestamps into the approved-input AI path, even when history is missing.