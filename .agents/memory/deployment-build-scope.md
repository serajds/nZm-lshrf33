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

**DO NOT add a `run` key to the root `[deployment]` section.** Adding `run` overrides the multi-artifact orchestrator and makes the deployment start only that one process, causing other artifact health checks to fail.

The production services are:
- `artifacts/api-server` → port 8080, path `/api`, run: `node --enable-source-maps artifacts/api-server/dist/index.mjs`
- `artifacts/construction-supervision` → static, path `/`, publicDir: `artifacts/construction-supervision/dist/public`

## Build scope rules

- **Keep the web TypeScript check mandatory.** React type packages are aligned through the workspace catalog so third-party declarations resolve one type identity. Do not restore `|| true` or otherwise make web type errors non-blocking.
- The mobile artifact was removed. Do not recreate its publishing service to fix an unrelated build failure. If reintroduced, keep Metro out of the root recursive build; it previously failed in the publishing environment.

**Why:** Multiple React type versions in the workspace previously leaked through hoisted third-party declarations and produced false incompatibilities in the web app.

**How to apply:** Keep React and React DOM type packages on the shared catalog version across artifacts, and run the root typecheck after dependency changes.

Force referenced-library declaration generation before application type checks; do not trust restored incremental compiler metadata alone.

**Why:** A task merge retained compiler metadata marking the current API schemas up to date while declaration output still described the older API. Publishing then reported missing deviation fields despite those fields existing in source.

**How to apply:** Keep the forced referenced-library build in the publishing check. Do not suppress web type errors or duplicate missing API types locally to conceal stale declarations.

## Critical: JWT_SECRET in production

`artifacts/api-server/src/lib/auth.ts` throws at startup in production if neither `JWT_SECRET` nor `SESSION_SECRET` is set. The fix already applied: use `SESSION_SECRET` as a fallback (`JWT_SECRET ?? SESSION_SECRET ?? throw`). If the server crashes immediately in production with no port opened and `/api` returns 500, test with: `PORT=8082 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs` from the workspace root.

## After any snapshot import, always verify:
1. Root `.replit` has `[deployment]` with ONLY `deploymentTarget` + `build` (NO `run`)
2. Root `package.json` typecheck filter excludes `@workspace/mockup-sandbox`
3. `artifacts/construction-supervision/package.json` typecheck remains mandatory (no `|| true`)
4. Each `artifacts/*/._replit-artifact/artifact.toml` is intact (do not overwrite these)

**Why:** `run` in root deployment was added as a guess but the real run orchestration lives in each artifact's `artifact.toml`. Snapshot imports strip `.replit` and these constraints must be manually restored.
