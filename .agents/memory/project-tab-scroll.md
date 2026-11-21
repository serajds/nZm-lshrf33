---
name: Project-tab scroll restoration
description: Preserving a shared scroll position when project routes swap asynchronously.
---

When keeping a shared navigation bar in the same viewport position across route changes, the destination page may mount before its data has created enough scrollable height. A one-time scroll assignment can be clamped at the top, and later data growth does not restore the intended position. Use bounded, content-change-triggered retries instead of a frequent polling timer, which can compete with touch scrolling on large pages. Stop restoring as soon as the user starts interacting.

**Why:** Lazy routes and API-loaded page content can temporarily make a destination appear too short to scroll.

**How to apply:** For scroll preservation across project tabs or similar route swaps, keep the pending position through the source route's unmount, observe destination layout/content changes, verify enough scroll range before clearing it, and cancel restoration on user input or a later navigation.
