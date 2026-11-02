// node artifacts/api-server/tests/run-activity-group-categories-integration.mjs
// Uses the configured DEVELOPMENT database only; does not change credentials.
import { build } from "esbuild";
import { createRequire, isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.env.NODE_ENV === "production") throw new Error("This fixture test is development-only");
const api = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../../generated-artifacts/category-integration.cjs", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("./activity-group-categories.integration.ts", import.meta.url))],
  outfile: output, bundle: true, platform: "node", format: "cjs",
  plugins: [{ name: "test-dependencies", setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, args => {
      if (isBuiltin(args.path)) return { path: args.path, external: true };
      return { path: require.resolve(args.path, { paths: [path.dirname(args.importer || path.join(api, "package.json")), api] }),
        external: !args.path.startsWith("@workspace/") };
    });
  } }],
});
const result = spawnSync(process.execPath, [output], { stdio: "inherit",
  env: { ...process.env, NODE_PATH: path.join(api, "node_modules") } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
