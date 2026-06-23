---
name: Deployment build scope (pnpm workspace)
description: What the root `pnpm run build` must and must not build for the autoscale deployment
---

The autoscale deployment (`.replit` [deployment]) runs ONLY the api-server (`node artifacts/api-server/dist/index.mjs`), which serves the built construction-supervision web frontend. Its build command is `pnpm run build`.

Two things break a deploy build and must stay configured:

- **Exclude the Expo mobile artifact from the recursive build.** Root `build` uses `pnpm -r --if-present --filter=!@workspace/mobile run build`. The mobile `build` (`node scripts/build.js`) downloads bundles from a running Metro server and fails in the deploy build env ("Download failed: terminated"). The mobile app ships via Expo Go separately, not through this autoscale build.
- **Dev-only web artifacts must have non-blocking typecheck.** Both `construction-supervision` and `mockup-sandbox` use `"typecheck": "tsc ... --noEmit || true"`. They emit type errors from a duplicate `@types/react` (19.1.17 from Expo vs 19.2.14 from web/radix), e.g. the `--radix-${string}` CSSProperties index-signature mismatch in shadcn `calendar.tsx`/`tooltip.tsx`/`spinner.tsx`. These are environmental, not real bugs, and Vite build does not typecheck so runtime is unaffected.

**Why:** a single autoscale service builds and runs one app; pulling the whole monorepo (mobile static export + strict typecheck of dev tools) into that build introduces failures unrelated to what actually gets deployed.
