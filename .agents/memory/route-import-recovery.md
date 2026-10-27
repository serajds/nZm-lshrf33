---
name: Route import recovery
description: Avoid secondary React crashes while recovering failed page-module requests
---

Treat module-fetch failures separately from component or hook errors. A guarded reload must not immediately rethrow the same import failure into React while navigation is pending.

**Why:** Repeated development restarts were followed by failed page-module requests, even though the same module URLs later returned HTTP 200. The old recovery path reloaded and threw, producing a secondary runtime crash. This does not establish the original network failure's cause.

**How to apply:** Limit automatic recovery to module-fetch failures, persist a one-reload guard before navigation, and offer explicit manual retry if it still fails or session storage is blocked. Do not suppress genuine code errors or disable the error overlay.
