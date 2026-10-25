import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Exercise the real AI handler with isolated history fixtures and a DB that
// rejects unexpected access. No live application data is read or written.
const schemaDir = new URL("../../../lib/db/src/schema/", import.meta.url);
const names = new Set(fs.readdirSync(schemaDir).filter(n => n.endsWith(".ts")).flatMap(n =>
  [...fs.readFileSync(new URL(n, schemaDir), "utf8").matchAll(/export const (\w+)/g)].map(m => m[1])));
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/routes/reports.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", packages: "external",
  plugins: [{
    name: "no-database",
    setup(b) {
      b.onResolve({ filter: /\/report-period-progress$/ }, () => ({ path: "history", namespace: "history-fixture" }));
      b.onLoad({ filter: /.*/, namespace: "history-fixture" }, () => ({
        contents: `export const getReportPeriodProgress = async (...args) =>
          globalThis.approvedHistoryFixture?.(...args) ?? {available:false,activities:null};
          export const validReportDay = value => typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value);`,
      }));
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `const fail = () => { throw new Error("Unexpected DB access"); };
          export const db = new Proxy({}, {get: (_, key) => key === "select"
            ? (...args) => globalThis.approvedDbSelectFixture ? globalThis.approvedDbSelectFixture(...args) : fail()
            : key === "update" ? (...args) => globalThis.approvedDbUpdateFixture?.(...args) ?? fail()
            : fail});
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
let handler, patchHandler;
try {
  const { default: router } = await import(path);
  handler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/ai-draft")
    .route.stack.at(-1).handle;
  patchHandler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/:id" && layer.route.methods.patch)
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
test("missing history still permits documented work without reading today's activities", async t => {
  const originalFetch = globalThis.fetch;
  let prompt;
  globalThis.fetch = async (_url, options) => {
    prompt = JSON.stringify(JSON.parse(options.body));
    const content = JSON.stringify({ workDescription: "تم صب سقف الدور الثاني.", technicalNotes: "لم تُقدَّم عوائق موثقة.", recommendations: "يوصى بالتحقق من توثيق فحوص الأعمال المذكورة." });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      candidates: [{ content: { parts: [{ text: content }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await invoke(base);
    if (res.code === 503) { t.skip("No AI provider configured; transport never called"); return; }
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.match(res.body.snapshotFingerprint, /^approved-activities:/);
    assert.ok(prompt.includes("صب سقف الدور الثاني"));
    assert.ok(prompt.includes("progressPercentage"));
    assert.equal(res.body.workDescription, "تم صب سقف الدور الثاني.");
  } finally { globalThis.fetch = originalFetch; }
});

const historicalRows = [{
  id: 1, name: "مباني الطوب بالدور الأول", actualProgress: 40, plannedProgress: 70,
  actualAsOfDate: base.periodEnd, plannedAsOfDate: base.periodEnd,
  plannedStartDate: "2026-09-01", plannedEndDate: "2026-10-15",
  externalSourceGroupId: 7,
}];
async function withPromptCapture(run) {
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages?.at(-1)?.content ?? request.contents?.[0]?.parts?.[0]?.text;
    prompts.push(prompt);
    const content = JSON.stringify({ workDescription: "تظهر البنود حالة تراكمية حتى نهاية الفترة.", technicalNotes: "فجوة عن المخطط المسجل.", recommendations: "يوصى بمتابعة البند." });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }], candidates: [{ content: { parts: [{ text: content }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try { await run(prompts); }
  finally {
    globalThis.fetch = originalFetch;
    delete globalThis.approvedHistoryFixture;
    delete globalThis.approvedDbSelectFixture;
  }
}
test("historical activities can generate a narrative without supervisor text and preserve approved aggregate", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedHistoryFixture = async (id, day) => {
      assert.equal(id, 1); assert.equal(day, base.periodEnd);
      return { available: true, activities: historicalRows };
    };
    const res = await invoke({ ...base, progressPercentage: 35, workDescription: "" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":40'));
    assert.ok(prompts[0].includes('"variancePoints":-30'));
    assert.ok(prompts[0].includes('"progressPercentage":35'));
    assert.ok(prompts[0].includes('"linkedSource":true'));
    const changed = await invoke({ ...base, workDescription: "" });
    assert.notEqual(res.body.snapshotFingerprint, changed.body.snapshotFingerprint);
  });
});
test("saved report uses its own dated snapshot, not new history or current project activities", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedHistoryFixture = () => { throw new Error("Saved report must not read newer history"); };
    globalThis.approvedDbSelectFixture = () => ({
      from: () => ({ where: async () => [{ id: 3, periodEnd: base.periodEnd, snapshot: historicalRows }] }),
    });
    const res = await invoke({ ...base, reportId: 3, workDescription: "" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":40'));
    const wrongPeriod = await invoke({ ...base, reportId: 3, periodEnd: "2026-10-01" });
    assert.equal(wrongPeriod.code, 409);
  });
});
test("unverified or missing historical activity values cannot replace missing work description", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedHistoryFixture = async () => ({
      available: true, activities: historicalRows.map(row => ({ ...row, actualHistoricalUnverified: true })),
    });
    const res = await invoke({ ...base, workDescription: "" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 400);
    assert.equal(prompts.length, 0);
    const documented = await invoke(base);
    assert.equal(documented.code, 200);
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":null'));
  });
});

test("legacy report without a snapshot analyses audit reconstruction without requiring a historical aggregate", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedDbSelectFixture = () => ({
      from: () => ({ where: async () => [{ id: 3, periodEnd: base.periodEnd, snapshot: null }] }),
    });
    globalThis.approvedHistoryFixture = async () => ({
      available: false, overallProgress: null,
      activities: historicalRows.map(row => ({ ...row, plannedHistoricalUnverified: true })),
    });
    const res = await invoke({ ...base, reportId: 3, workDescription: "" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 200);
    assert.ok(prompts[0].includes('"plannedProgressAsOfPeriodEnd":null'));
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":40'));
  });
});

test("manual period approval feeds AI even for a missing historical value and keeps plan unknown", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedDbSelectFixture = () => ({
      from: () => ({ where: async () => [{ id: 3, periodEnd: base.periodEnd, snapshot: null }] }),
    });
    globalThis.approvedHistoryFixture = async () => ({
      available: false, activities: [{
        id: 8, name: "بند قديم", actualProgress: 0, status: "unknown",
        actualHistoricalUnverified: true, plannedHistoricalUnverified: true,
      }],
    });
    const res = await invoke({ ...base, reportId: 3, workDescription: "",
      snapshotOverrides: [{ id: 8, actualProgress: 65, status: "in_progress", actualManuallyApproved: true }],
    });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 200);
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":65'));
    assert.ok(prompts[0].includes('"plannedProgressAsOfPeriodEnd":null'));
    assert.ok(prompts[0].includes('"approvedStatus":"in_progress"'));
    assert.ok(prompts[0].includes("لا تذكر اللقطات"));
  });
});

test("saving legacy item approvals writes only the report snapshot and preserves its aggregate", async () => {
  let reads = 0, saved;
  globalThis.approvedDbSelectFixture = () => ({
    from: () => ({ where: async () => ++reads === 1
      ? [{ source: null, periodEnd: base.periodEnd, percentage: 40 }]
      : [{ snapshot: null }] }),
  });
  globalThis.approvedHistoryFixture = async () => ({
    available: false, activities: [{
      id: 8, name: "بند", actualProgress: 0, actualHistoricalUnverified: true,
      plannedHistoricalUnverified: true, referenceOnly: true,
    }],
  });
  globalThis.approvedDbUpdateFixture = () => ({
    set: values => { saved = values; return {
      where: () => ({ returning: async () => [{ id: 3, reportNumber: 1, ...values }] }),
    }; },
  });
  try {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await patchHandler({ params: { projectId: "1", id: "3" }, body: {
      reportDate: base.reportDate,
      activitiesSnapshot: [{ id: 8, actualProgress: 65, status: "in_progress", actualManuallyApproved: true }],
    } }, res, () => {});
    assert.equal(saved.progressPercentage, undefined);
    assert.equal(saved.progressSource, "manual");
    assert.equal(saved.activitiesSnapshot[0].actualProgress, 65);
    assert.equal(saved.activitiesSnapshot[0].actualAsOfDate, base.periodEnd);
    assert.equal(saved.activitiesSnapshot[0].actualHistoricalUnverified, false);
    assert.equal(saved.activitiesSnapshot[0].plannedHistoricalUnverified, true);
  } finally {
    delete globalThis.approvedDbSelectFixture;
    delete globalThis.approvedDbUpdateFixture;
    delete globalThis.approvedHistoryFixture;
  }
});

test("incomplete provider response is rejected instead of leaving report sections silently empty", async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const content = JSON.stringify({ workDescription: "تم صب سقف الدور الثاني.", technicalNotes: "", recommendations: "" });
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
      candidates: [{ content: { parts: [{ text: content }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const res = await invoke(base);
    if (res.code === 503) { t.skip("No AI provider configured"); return; }
    assert.equal(res.code, 502);
    assert.match(res.body.error, /الأقسام الثلاثة/);
    assert.equal(res.body.workDescription, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("live synthetic report produces complete professional sections without database access", {
  skip: !process.argv.includes("--live-ai"),
}, async () => {
  const cases = [{
    ...base,
  }, {
    ...base,
    workDescription: "استكمال صب سقف الدور الثاني، ومواصلة مباني الطوب بالدور الأول.",
    technicalNotes: "تأخر توريد دفعة من الطوب دون تحديد أثرها على سير العمل.",
  }];
  for (const input of cases) {
    const res = await invoke(input);
    assert.equal(res.code, 200, JSON.stringify(res.body));
    for (const key of ["workDescription", "technicalNotes", "recommendations"]) {
      assert.ok(typeof res.body[key] === "string" && res.body[key].trim());
    }
    if (!input.technicalNotes) {
      assert.doesNotMatch(res.body.technicalNotes, /لا توجد (أي )?(عوائق|ملاحظات)/);
    }
    console.log("Synthetic live report:", JSON.stringify(res.body));
  }
  globalThis.approvedHistoryFixture = async () => ({ available: true, activities: historicalRows });
  try {
    const res = await invoke({ ...base, progressPercentage: 35, workDescription: "" });
    assert.equal(res.code, 200, JSON.stringify(res.body));
    console.log("Synthetic live activity analysis:", JSON.stringify(res.body));
  } finally { delete globalThis.approvedHistoryFixture; }
});
