---
name: Expo types in shared workspaces
description: Prevent Expo React/runtime and type dependencies from breaking sibling apps in a pnpm workspace.
---

When adding an Expo app to a pnpm workspace, its newer React version or type packages can change peer resolution for shared React packages and break existing web typechecks even when the mobile app is excluded from root scripts. Existing `node_modules` may also retain stale peer links after dependency versions change.

**Why:** Expo and React Native depend on newer React types than sibling web apps, while shared workspace packages may resolve their React peer from whichever app was installed most recently.

**How to apply:** Keep mobile React types on the workspace catalog when the native runtime accepts them, pin shared-library peer resolution to the intended host React version, then verify with a frozen install, a clean peer-link refresh when needed, and both mobile and root checks.
