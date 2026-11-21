import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production auth refuses to load without a configured signing secret", () => {
  const child = spawnSync(process.execPath, [
    "--import",
    "./scripts/node_modules/tsx/dist/loader.mjs",
    "--input-type=module",
    "-e",
    "await import('./artifacts/api-server/src/lib/auth.ts')",
  ], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      JWT_SECRET: "",
      SESSION_SECRET: "",
    },
  });
  assert.notEqual(child.status, 0);
  assert.match(`${child.stdout}\n${child.stderr}`, /JWT_SECRET or SESSION_SECRET environment variable is required in production/);
});
