---
name: Browser testing across artifacts
description: Cross-artifact API routing and simulated pointer interactions in browser checks.
---

For end-to-end browser checks of the web UI that call the API artifact, use the proxied development domain rather than directly navigating to the Vite server port.

**Why:** The web page loaded from the local Vite port, but its API proxy targeted a local port with no listener and authentication silently landed on the login page. The development domain correctly routed the same API calls to the running API artifact.

**How to apply:** When a local browser test unexpectedly fails authentication despite a valid session, verify the origin and API route before changing auth logic. Keep local ports for isolated frontend checks.

When the managed API workflow is stopped but an ephemeral API test server listens on the Vite proxy target, use the local Vite URL for isolated browser checks instead of the proxied development domain.

**Why:** The development domain can route `/api` to the stopped API artifact and return 502 even while Vite's local `/api` proxy reaches the ephemeral test server correctly.

**How to apply:** Check `/api` from both origins before browser testing; use the one that reaches the intended development-only server. Do not infer an authentication regression from a routing failure.

Radix dropdown triggers may not open from a programmatic `HTMLElement.click()` in Chrome DevTools Protocol tests.

**Why:** The trigger was present and the click method returned, but no menu appeared; a real mouse press/release at its onscreen position opened it.

**How to apply:** Scroll the trigger into view, read its bounding rect, and dispatch mouse press/release events at its center before asserting menu state. Programmatic click still works for menu actions.