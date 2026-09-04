---
name: Vite workspace export cache
description: Handling stale optimized workspace-package exports in the web development server.
---

When a merge adds an export to a workspace package that is forced through Vite `optimizeDeps`, the running development server may keep serving a pre-merge optimized module that lacks the new export.

**Why:** Restarting Vite alone can reuse the artifact-local generated dependency cache, producing a browser error that the requested module does not provide an export even though the source and declarations both contain it.

**How to apply:** When this exact source/cache mismatch appears, clear only the affected web artifact’s generated `node_modules/.vite` cache, then restart its workflow. Keep the package optimized unless the performance tradeoff is intentionally reconsidered.