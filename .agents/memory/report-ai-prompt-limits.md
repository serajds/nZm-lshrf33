---
name: Report AI prompt limits
description: Why prompt-only controls cannot guarantee owner-ready engineering prose
---

An AI report prompt can guide tone and prohibit labels, repetition, and unsupported causal claims, but cannot guarantee those constraints on every generation. A realistic synthetic engineering example passed explicit forbidden-label checks while occasionally repeating a completed activity in the observations or implying site actions not established by the notes.

**Why:** Repeated live runs with increasingly specific instructions removed overt labels and shortened the text, but the provider still sometimes ignored narrower editorial constraints.

**How to apply:** If strict owner-ready output is required, test multiple representative generations and use an explicit output-review or retry step rather than claiming prompt wording alone guarantees compliance. Keep historical provenance and source-of-truth rules separate from style guidance.