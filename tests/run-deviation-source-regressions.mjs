import { execFileSync } from "node:child_process";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

// Older integration scripts create fixtures in their selected DB. Run them
// against a new disposable cluster, never the workspace or production database.
const postgres = await isolatedPostgres();
try {
  for (const file of [
    "artifacts/api-server/tests/group-side-project-sync-integration.ts",
    "artifacts/api-server/tests/final-hardening-regression.ts",
  ]) {
    execFileSync(process.execPath, ["--import", "./scripts/node_modules/tsx/dist/loader.mjs", file], {
      env: { ...process.env, LOG_LEVEL: "silent" }, stdio: "inherit", timeout: 120_000,
    });
  }
} finally {
  await postgres.stop();
}
