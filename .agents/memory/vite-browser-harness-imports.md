---
name: Vite browser-test harness imports
description: How a programmatic Vite browser harness can load workspace TypeScript outside its artifact root.
---

Dynamic HTML returned from Vite middleware does not rewrite bare module specifiers inside its inline module script. Import workspace source through Vite's `/@fs` path and explicitly allow the workspace root in `server.fs.allow`.

**Why:** A browser harness can appear healthy at the HTTP layer while its module fails before exposing the test API. Disabling dependency discovery also requires explicitly including any optimized dependencies the harness needs.

**How to apply:** For real-browser tests served from an artifact-root Vite server, capture page exceptions, use `/@fs` for source outside that root, and pair `optimizeDeps.noDiscovery` with a minimal `include` list.