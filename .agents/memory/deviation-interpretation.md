---
name: Deviation interpretation boundaries
description: Business limits on what progress-based variance, suspension and historical indicators may claim
---

Progress-based indicators are not critical-path analysis, financial earned value, or proof of contractual delay/extension entitlement. The current scheduled end is not evidence of the original contractual end. Organizational portfolio children must not become progress sources merely because they are children.

**Why:** The user explicitly set these boundaries for reliable, explainable deviation analysis while preserving project data and permissions.

**How to apply:** In future summaries, forecasts or report calculations, distinguish percentage-point variance, estimated day-equivalent, elapsed calendar overrun and conditional forecast. A suspension record or schedule-shift flag is not evidence of causal delay relief; overlapping or previously shifted periods cannot be mechanically deducted. A completed percentage does not establish an actual completion date.

Present forecast timing as explicitly early, late, or on the scheduled date, not as a negative number labeled “delay.” Distinguish the currently scheduled end from a conditional completion estimate.

**Why:** The user found the production “negative delay” card confusing and requested removing that ambiguity without changing the calculations.

**How to apply:** Keep unknown forecasts unknown; do not imply on-time completion from missing data, or describe an estimated 100% as a guarantee.

Describe a positive forecast difference as a conditional expected overrun of the scheduled end, not as an actual delay. Explain that the initial average pace may differ from later phases.

**Why:** The user approved clarifying a large early-stage forecast that looked like an already-incurred delay despite actual progress being ahead of today's plan.

**How to apply:** Keep forecast wording separate from elapsed overrun and contractual delay, without changing the underlying calculation or project data.

Historical snapshots may contain weighted source-group planned percentages that cannot be reconstructed from that group's earliest/latest dates. Do not recalculate a report's historical planned aggregate from current activities or from its date envelope.

**Why:** Source groups can contain children with different schedules and weights; an envelope loses that distribution, while today's source membership cannot establish historical membership.

**How to apply:** Use documented period-scoped saved values and provenance. Preserve unknown intervals and independent live readings, including when a report shares today's date. Never backfill history from live data or a synthetic zero.
