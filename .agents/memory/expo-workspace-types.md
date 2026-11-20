---
name: Expo types in shared workspaces
description: Prevent Expo React/runtime and type dependencies from breaking sibling apps in a pnpm workspace.
---

When adding an Expo app to a pnpm workspace, its newer React version or type packages can change shared peer resolution and break sibling typechecks even when mobile is excluded from root scripts. In particular, `react-native-gesture-handler` can bring `@types/react-test-renderer`, whose wildcard React-type dependency may hoist a newer `@types/react` into pnpm's shared fallback path. Expo's newer TypeScript can also become an implicit peer for tools such as Orval.

**Why:** Multiple React/type versions coexist in the workspace, and tools that omit explicit type or TypeScript peers can resolve through pnpm's shared fallback instead of their host artifact's pinned version.

**How to apply:** Keep mobile React types on the workspace catalog when the native runtime accepts them; pin transitive React types to that catalog version when they leak across artifacts, and declare TypeScript directly in packages whose generators need it. Verify from a clean/frozen install and run both mobile and root checks.
