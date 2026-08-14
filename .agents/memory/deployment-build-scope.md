---
name: Deployment build scope (pnpm workspace)
description: What the root `pnpm run build` must and must not build for the autoscale deployment, and how the multi-artifact run is configured
---

This is a **multi-artifact monorepo**. Each artifact under `artifacts/` has its own `.replit-artifact/artifact.toml` that defines its own `[services.production]` build and run commands. The platform's multi-artifact orchestrator reads these to start each service independently.

## Correct root `.replit` [deployment] section

```toml
[deployment]
deploymentTarget = "autoscale"
build = ["pnpm", "run", "build"]
```

**DO NOT add a `run` key to the root `[deployment]` section.** Adding `run` overrides the multi-artifact orchestrator and makes the deployment start only that one process, causing health checks on `/mobile/` and `/api` to fail and the promote step to fail with "Creating Autoscale service" error.

The production services are:
- `artifacts/api-server` → port 8080, path `/api`, run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- `artifacts/construction-supervision` → static, path `/`, publicDir: `artifacts/construction-supervision/dist/public`
- `artifacts/mobile` → port 18115, path `/mobile/`, run: `pnpm --filter @workspace/mobile run serve`

## Build scope rules

- **Exclude `mockup-sandbox` from root typecheck.** Root `typecheck` uses `--filter "!@workspace/mockup-sandbox"`. It has a duplicate `@types/react` conflict (19.1.17 from Expo vs 19.2.14). `construction-supervision` still runs with `|| true`. After any snapshot import, verify both.
- The root build (`pnpm run typecheck && pnpm -r --if-present run build`) runs ALL artifact builds including mobile Metro bundler — this is fine and expected.

## After any snapshot import, always verify:
1. Root `.replit` has `[deployment]` with ONLY `deploymentTarget` + `build` (NO `run`)
2. Root `package.json` typecheck filter excludes `@workspace/mockup-sandbox`
3. `artifacts/construction-supervision/package.json` typecheck has `|| true`
4. Each `artifacts/*/._replit-artifact/artifact.toml` is intact (do not overwrite these)

**Why:** `run` in root deployment was added as a guess but the real run orchestration lives in each artifact's `artifact.toml`. Snapshot imports strip `.replit` and these constraints must be manually restored.
