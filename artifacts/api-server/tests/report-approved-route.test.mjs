import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Exercise the real AI handler with a DB that always fails on access and a
// fake AI transport. Never query development data or send a provider request.
const schemaDir = new URL("../../../lib/db/src/schema/", import.meta.url);
const names = new Set(fs.readdirSync(schemaDir).filter(n => n.endsWith(".ts")).flatMap(n =>
  [...fs.readFileSync(new URL(n, schemaDir), "utf8").matchAll(/export const (\w+)/g)].map(m => m[1])));
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/routes/reports.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", packages: "external",
  plugins: [{
    name: "no-database",
    setup(b) {
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `const fail = () => { throw new Error("Unexpected DB access"); };
          export const db = new Proxy({}, {get: () => fail});
          export const pool = { query: fail };
          ${[...names].map(n => `export const ${n} = {};`).join("\n")}`,
      }));
    },
  }],
});
// Materialize the test bundle beside node_modules so external modules resolve.
// The generated directory is ignored by Git; no application data is written.
const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
const dir = await mkdtemp(new URL("../node_modules/.approved-route-", import.meta.url));
const path = `${dir}/route.mjs`;
await writeFile(path, compiled.outputFiles[0].text);
let handler;
try {
  const { default: router } = await import(path);
  handler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/ai-draft")
    .route.stack.at(-1).handle;
} finally { await rm(dir, { recursive: true, force: true }); }

const base = {
  approvedReportInputs: true, progressPercentage: 40,
  workDescription: "صب سقف الدور الثاني",
  reportDate: "2026-10-25", periodStart: "2026-09-01", periodEnd: "2026-09-30",
};
async function invoke(body) {
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { projectId: "1" }, body, log: { error() {} } }, res, () => {});
  return res;
}
test("approved route requires explicit valid percentage and period work", async () => {
  for (const patch of [{ progressPercentage: null }, { progressPercentage: "" }, { progressPercentage: 101 }, { workDescription: " " }]) {
    assert.equal((await invoke({ ...base, ...patch })).code, 400);
  }
});
test("old period can be drafted from approved inputs without historical/current DB reads", async t => {
  const originalFetch = globalThis.fetch;
  let prompt;
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.stringify(JSON.parse(options.body));
    const content = JSON.stringify({ workDescription: "تم صب سقف الدور الثاني.", technicalNotes: "", recommendations: "" });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      candidates: [{ content: { parts: [{ text: content }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await invoke(base);
    if (res.code === 503) { t.skip("No AI provider configured; transport never called"); return; }
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.match(res.body.snapshotFingerprint, /^approved:/);
    assert.ok(prompt.includes("صب سقف الدور الثاني"));
    assert.ok(prompt.includes("progressPercentage"));
    assert.equal(res.body.workDescription, "تم صب سقف الدور الثاني.");
  } finally { globalThis.fetch = originalFetch; }
});
