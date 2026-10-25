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

The user approved the simpler report-level approach: choose the reporting period, confirm an editable cumulative percentage through its end (suggest from sufficient history, otherwise require manual input), and optionally describe work actually performed during that period. They subsequently clarified: “من المفترض ان يحلل البنود ويستنتج منها أيضا”. AI must analyse verified period-end activity states and planned comparisons as well as the supervisor's text, not merely paraphrase it.

**Why:** The user requested a less complicated solution than entering an effective progress date for each activity and confirmed it with “رائع”, but rejected limiting the AI to their wording alone.

**How to apply:** Keep the approved percentage and narrative scoped to the report and frozen after saving; do not change live project progress or existing reports. A manually approved aggregate does not establish historical progress for individual activities. Analyse dated historical values; use saved snapshots for existing reports. Distinguish cumulative state from work executed during the period. Missing history cannot be replaced with today's values or zeros; supervisor text remains usable when historical analysis is unavailable.

For legacy reports without snapshots, show the available activity catalogue and schedule as explicitly labelled reference material, and use the last dated audit progress before the period cutoff where available. Keep the approved aggregate independent; unknown historical membership and weights prevent reconstructing an aggregate from today's catalogue.

**Why:** The user rejected hiding all work items in an existing project and approved using the previous progress log while preserving AI analysis.

**How to apply:** Reconstruct read-only without importing logs or changing saved reports. Missing values remain “غير موثق للفترة”; current schedule is not evidence for historical variance/SPI. Linked-source audit aggregates alone are insufficient without dated source membership/weights.

Keep manual-entry provenance and system diagnostic messages internal; do not label owner-facing reports “معتمدة يدويًا للتقرير” or explain snapshot/date mismatches and unavailable historical SPI.

**Why:** The user clarified that issued reports go to the owner and these internal workflow labels are inappropriate there.

**How to apply:** Retain provenance in the editor/audit data, but present supervisor-approved figures as report figures in the issued document and AI narrative. Omit unsupported comparisons and use a dash for unknown item values rather than exposing diagnostics. Keep genuine technical observations and obstacles. This does not authorize presenting unknown or current values as verified historical facts.

Do not hide existing report percentages merely because their historical provenance is uncertain. Display saved report values and local edits without adding new approval steps; distinguish genuinely missing values from provenance warnings.

**Why:** The user became confused after hiding internal diagnostic messages also hid planned/actual figures, and approved a display-only correction rather than another workflow.

**How to apply:** Preserve saved numbers, including zero. Do not fill gaps from today's project progress or use provenance-uncertain values to invent historical SPI. Keep AI and project data unchanged when correcting display.

Manual item progress approved for a report's period may feed its AI narrative without changing live activities. The report aggregate stays independent of item edits.

**Why:** The user approved editing old report items and regenerating the narrative, while rejecting internal provenance labels in the issued document.

**How to apply:** Scope the approval to the report period; distinguish manual approval internally from historical observations. Do not silently recompute the report aggregate or modify other reports.