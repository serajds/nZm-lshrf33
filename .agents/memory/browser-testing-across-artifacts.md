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

Direct browser imports of Vite-optimized CommonJS dependencies may expose their API under `module.default`, even though Vite-transformed application imports work as named imports.

**Why:** Programmatic browser fixtures do not receive Vite's import interop rewrite; this can make a healthy React application appear to have a missing rendering API.

**How to apply:** Reuse the application's exact transformed dependency URLs and normalize imported namespaces with `module.default ?? module`. Do not install a second copy of React to repair a fixture.

Separate Chrome debugging targets share storage when they use the same browser profile, even after a previous target closes.

**Why:** A prior fixture's synthetic token can make a later guest-startup check unexpectedly load an authenticated screen.

**How to apply:** Clear storage before each navigation only in a dedicated, isolated test profile, or use isolated browser contexts. Never clear the user's actual browser profile as test setup.

CDP checks using `Runtime.evaluate` with `returnByValue` should return primitives, not DOM elements.

**Why:** Serializing a successful element lookup can fail with “Object reference chain is too long,” making a healthy page look like a failed browser check.

**How to apply:** Convert readiness predicates to booleans inside the browser and return only the small fields needed for assertions.

For pointer-driven checks, bring the actual control into view before measuring its rectangle; do not assume the window is the scrolling container.

**Why:** The signed-in layout scrolls internally. Window scrolling left drag handles outside the viewport, so simulated drags sent no requests even though the application was working.

**How to apply:** Use the control's `scrollIntoView`, then verify its coordinates and hit target before judging a drag failure.

Wait for a new document after CDP reloads and let responsive/entrance transitions settle before geometry assertions.

**Why:** Reload can resolve while the previous heading still exists, and viewport changes can briefly report old layout bounds. These produced false footer clipping and page-height failures.

**How to apply:** Compare `performance.timeOrigin` before and after reload, require document readiness, and measure stable bounds after viewport/route transitions rather than immediately.

In a shared create/edit dialog opened programmatically from a row, explicitly return keyboard focus to the actual opener without scrolling; fall back to a stable list when filtering removes that row.

**Why:** Default dialog focus restoration can target the creation trigger above the list, producing a jump that users perceive as a full page refresh even when the document and row never remount.

**How to apply:** Diagnose document loads, internal scrolling, row identity, and focus separately. Preserve normal creation-trigger behavior and continue refreshing live data; do not mask a focus bug by disabling refetches.

For report previews opened in a popup, image requests may run in the opener and become `blob:` URLs in the popup; measure network timing and bytes in the opener.

**Why:** A signed-in popup test rendered all 50 prepared print images and invoked printing, while counting API requests from the popup returned fewer than 50 because the fetch callback belonged to the opener.

**How to apply:** Assert preview text, thumbnail readiness, zoom dimensions, and successful print preparation in the popup; measure resource entries from the opener and verify variant URL construction/server profile selection with focused unit/API tests.