---
name: Browser testing across artifacts
description: Cross-artifact API routing in browser checks differs between a direct Vite port and the Replit preview domain.
---

For end-to-end browser checks of the web UI that call the API artifact, use the proxied development domain rather than directly navigating to the Vite server port.

**Why:** The web page loaded from the local Vite port, but its API proxy targeted a local port with no listener and authentication silently landed on the login page. The development domain correctly routed the same API calls to the running API artifact.

**How to apply:** When a local browser test unexpectedly fails authentication despite a valid session, verify the origin and API route before changing auth logic. Keep local ports for isolated frontend checks.