---
name: Report AI prompt limits
description: Why prompt-only controls cannot guarantee owner-ready engineering prose
---

An AI report prompt can guide tone and prohibit labels, repetition, and unsupported causal claims, but cannot guarantee those constraints on every generation. A realistic synthetic engineering example passed explicit forbidden-label checks while occasionally repeating a completed activity in the observations or implying site actions not established by the notes.

**Why:** Repeated live runs with increasingly specific instructions removed overt labels and shortened the text, but the provider still sometimes ignored narrower editorial constraints.

**How to apply:** If strict owner-ready output is required, test multiple representative generations and use an explicit output-review or retry step rather than claiming prompt wording alone guarantees compliance. Keep historical provenance and source-of-truth rules separate from style guidance.

All three report narrative sections should be filled and professionally written, even when the supervisor supplies only the period's work.

**Why:** The user found the short description unprofessional and explicitly reported empty technical notes and recommendations as a problem.

**How to apply:** Missing technical notes mean no documented observations were supplied, not proof that no obstacles exist. Recommendations may propose concrete preventive follow-up tied to the supplied work; label them as proposals and never invent defects, test results or site events. Do not report a generation as successful if any required narrative section is empty.

For numeric executive summaries, let the model prioritize validated evidence rather than author authoritative arithmetic or forecast dates. Render facts from the same read-only snapshot used by the deviation analysis. Restrict actions to those actually allowed for each evidence item, validate the selections, and allow only a bounded retry before an explicit error.

**Why:** The live model changed the completion date despite mostly copying correct progress figures; a later constrained run selected a completion-only action for an incomplete activity. Prompt wording alone did not prevent either error.

**How to apply:** Keep AI ranking and work-item analysis, but do not mix narrative from one snapshot with cached page figures from another. Missing baseline, stale sources, and unproven suspension effects must remain explicit uncertainties, not healthy zeros.