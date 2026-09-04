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

- **Keep the web TypeScript check mandatory.** React type packages are aligned through the workspace catalog so third-party declarations resolve one type identity. Do not restore `|| true` or otherwise make web type errors non-blocking.
- **Exclude `@workspace/mobile` from the root recursive build.** Root `build` must use `pnpm -r --if-present --filter=!@workspace/mobile run build`. The mobile Metro bundler cannot run in the deployment build environment (fails with "Download failed: terminated"); mobile is built separately by its own `artifact.toml` `[services.production]` build command.
- **Keep mobile React type packages on the shared catalog version.** With Expo 54 / React Native 0.81, `react-native-gesture-handler` 2.28 may lose `children` in JSX under the shared React 19.2 types; use a narrow local `PropsWithChildren` component wrapper rather than pinning mobile to React types 19.1.

**Why:** Multiple React type versions in the workspace leaked through hoisted third-party declarations and produced false incompatibilities in the web app. Pinning mobile back to 19.1 fixes one mobile declaration but reintroduces the web failures; alignment plus a local compatibility wrapper keeps both checks sound.

**How to apply:** Keep React and React DOM type packages on the shared catalog version across artifacts, and run the root typecheck after dependency changes.

## Critical: JWT_SECRET in production

`artifacts/api-server/src/lib/auth.ts` throws at startup in production if neither `JWT_SECRET` nor `SESSION_SECRET` is set. The fix already applied: use `SESSION_SECRET` as a fallback (`JWT_SECRET ?? SESSION_SECRET ?? throw`). If the server crashes immediately in production with no port opened and `/api` returns 500, test with: `PORT=8082 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs` from the workspace root.

## After any snapshot import, always verify:
1. Root `.replit` has `[deployment]` with ONLY `deploymentTarget` + `build` (NO `run`)
2. Root `package.json` typecheck filter excludes `@workspace/mockup-sandbox`
3. `artifacts/construction-supervision/package.json` typecheck remains mandatory (no `|| true`)
4. Each `artifacts/*/._replit-artifact/artifact.toml` is intact (do not overwrite these)

**Why:** `run` in root deployment was added as a guess but the real run orchestration lives in each artifact's `artifact.toml`. Snapshot imports strip `.replit` and these constraints must be manually restored.
