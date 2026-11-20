---
name: Project-tab scroll restoration
description: Preserving a shared scroll position when project routes swap asynchronously.
---

When keeping a shared navigation bar in the same viewport position across route changes, the destination page may mount before its data has created enough scrollable height. A one-time scroll assignment can be clamped at the top, and later data growth does not restore the intended position. Retry only while the target position is clamped, with a strict timeout.

**Why:** Lazy routes and API-loaded page content can temporarily make a destination appear too short to scroll.

**How to apply:** For scroll preservation across project tabs or similar route swaps, verify the destination has enough scroll range before clearing the pending position; keep retries bounded and cancel them if navigation changes again.
