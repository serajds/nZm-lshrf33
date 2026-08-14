---
name: Replacing project from an external GitHub snapshot
description: How to safely overwrite the whole project with a clone of the same repl exported to GitHub
---

When the user asks to replace the current project with a GitHub snapshot that is itself an export of this same repl (same monorepo/artifacts layout):

- Clone to a temp dir and confirm it is the same project (identical root layout) before touching anything; the diff is usually concentrated in a single artifact, not a full rewrite.
- Copy source dirs (`artifacts`, `lib`, `scripts`) and root files from the clone, but PRESERVE the Replit infra that is not part of app code and would break the env if clobbered: `.git`, `.local`, `.cache`, `.config`, `node_modules`, `.agents`, `attached_assets`.
- `rsync` is NOT installed — use `cp -a` (rm the target source dir first, then copy) instead of trying to rsync.
- `.replit` (and `.replitignore`) are protected from direct file writes; `cp` over them fails. They are env-managed and usually identical to the snapshot anyway, so just skip them.
- The snapshot's `artifacts/api-server/package.json` `start` script may carry `node --env-file=.env ...`; this Replit env has NO `.env` (secrets are platform-injected), and node hard-crashes on a missing env-file. Keep `--env-file=.env` REMOVED after every import, even on a "verbatim/بالكامل" replace — it is required platform glue, not a feature change.
- The snapshot's `artifacts/api-server/package.json` `dev` script may use `set NODE_ENV=development&&` (Windows cmd syntax). On Linux this silently fails and NODE_ENV stays unset, causing the JWT_SECRET "required in production" error. Fix to `NODE_ENV=development pnpm run build && NODE_ENV=development pnpm run start`.
- The snapshot may be missing `artifacts/mobile/.expo/types/router.d.ts`; expo-router writes it at runtime but crashes if the parent dir doesn't exist. Create it with `mkdir -p artifacts/mobile/.expo/types && touch artifacts/mobile/.expo/types/router.d.ts` after copying.
- The snapshot's `pnpm-workspace.yaml` may carry a malformed `onlyBuiltDependencies: sharp` (scalar). pnpm install then dies with `settings.onlyBuiltDependencies.push is not a function`. Fix it to a YAML list (`- sharp` / `- esbuild`) before installing.
- After copying, run `pnpm install` (package.json/lockfile may change), then restart all workflows. The live file-swap + reinstall throws transient vite/metro errors (missing vite.config, tailwind not found, uv_cwd) under the running servers — a clean restart clears them.

- The `.replit` file is protected from `cp` overwrites (env-managed). However, after a ZIP import the Replit system may silently DROP the `[deployment]` section if the imported archive had a different or missing `.replit`. Always verify `.replit` contains `[deployment]` with `deploymentTarget`, `build`, and `run` after any snapshot import. The correct deployment config is: `deploymentTarget = "autoscale"`, `build = ["pnpm", "run", "build"]`, `run = ["node", "artifacts/api-server/dist/index.mjs"]`. Fix it by writing a new file and calling `verifyAndReplaceDotReplit`.

**Why:** a full `rm -rf` + recopy of the whole workspace destroys the Replit environment (skills, version control, installed deps) and is unrecoverable.
