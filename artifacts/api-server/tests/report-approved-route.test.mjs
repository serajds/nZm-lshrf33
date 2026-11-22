import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("owner portal and PDF exports only include explicitly approved reports", () => {
  const ownerSource = fs.readFileSync(new URL("../src/routes/owner.ts", import.meta.url), "utf8");
  const pdfSource = fs.readFileSync(new URL("../src/routes/pdf.ts", import.meta.url), "utf8");

  assert.match(
    ownerSource,
    /\.where\(and\(eq\(reportsTable\.projectId, project\.id\), eq\(reportsTable\.status, "approved"\)\)\)/,
  );
  assert.match(
    pdfSource,
    /const reportConditions = \[eq\(reportsTable\.projectId, projectId\), eq\(reportsTable\.status, "approved"\)\]/,
  );
  assert.match(pdfSource, /reportConditions\.push\(eq\(reportsTable\.id, requestedReportId\)\)/);
});

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
      b.onResolve({ filter: /\/lib\/audit$/ }, () => ({ path: "audit", namespace: "audit-fixture" }));
      b.onLoad({ filter: /.*/, namespace: "audit-fixture" }, () => ({
        contents: "export const logAudit = async () => {};",
      }));
      b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: `const fail = () => { throw new Error("Unexpected DB access"); };
          export const db = new Proxy({}, {get: (_, key) => key === "select"
            ? (...args) => globalThis.approvedDbSelectFixture ? globalThis.approvedDbSelectFixture(...args) : fail()
            : key === "update" ? (...args) => globalThis.approvedDbUpdateFixture?.(...args) ?? fail()
            : key === "insert" ? (...args) => globalThis.approvedDbInsertFixture?.(...args) ?? fail()
            : fail});
          export const pool = { query: fail };
          export const measurePhase = (_name, run) => run();
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
let handler, createHandler, patchHandler, statusHandler, reportsListHandler;
try {
  const { default: router } = await import(path);
  handler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/ai-draft")
    .route.stack.at(-1).handle;
  createHandler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports" && layer.route.methods.post)
    .route.stack.at(-1).handle;
  patchHandler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/:id" && layer.route.methods.patch)
    .route.stack.at(-1).handle;
  statusHandler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/:id/status" && layer.route.methods.patch)
    .route.stack.at(-1).handle;
  reportsListHandler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports" && layer.route.methods.get)
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
async function invokeStatus(status, report) {
  globalThis.approvedDbSelectFixture = () => ({
    from: () => ({ where: async () => [report] }),
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    globalThis.approvedDbUpdateFixture = () => ({
      set: data => ({
        where: () => ({ returning: async () => [{ id: 1, projectId: 1, reportNumber: 1, reportDate: report.periodEnd, ...report, ...data }] }),
      }),
    });
    await statusHandler({ params: { projectId: "1", id: "1" }, body: { status }, user: { userId: 1 } }, res, () => {});
    return res;
  } finally {
    delete globalThis.approvedDbSelectFixture;
    delete globalThis.approvedDbUpdateFixture;
  }
}
async function invokeReportsList(report) {
  globalThis.approvedDbSelectFixture = projection => ({
    from: () => ({
      where: () => ({
        orderBy: async () => projection ? [report] : [],
      }),
    }),
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await reportsListHandler({ params: { projectId: "1" }, query: {} }, res, () => {});
    return res;
  } finally {
    delete globalThis.approvedDbSelectFixture;
  }
}
async function invokeCreate(body) {
  let inserted;
  globalThis.approvedDbSelectFixture = () => ({
    from: () => ({ where: async () => [{ maxNum: 2 }] }),
  });
  globalThis.approvedDbInsertFixture = () => ({
    values: data => {
      inserted = data;
      return { returning: async () => [{ id: 12, projectId: 1, reportNumber: 3, status: "draft", ...data }] };
    },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  try {
    await createHandler({ params: { projectId: "1" }, body, user: { userId: 1 } }, res, () => {});
    return { response: res, inserted };
  } finally {
    delete globalThis.approvedDbSelectFixture;
    delete globalThis.approvedDbInsertFixture;
  }
}
async function invokePatch(body, saved = {}) {
  let update;
  globalThis.approvedDbSelectFixture = () => ({
    from: () => ({ where: async () => [{
      source: null,
      periodStart: "2099-12-01",
      periodEnd: "2099-12-20",
      reportDate: "2099-12-20",
      percentage: null,
      status: "draft",
      ...saved,
    }] }),
  });
  globalThis.approvedDbUpdateFixture = () => ({
    set: data => {
      update = data;
      return { where: () => ({ returning: async () => [{ id: 4, projectId: 1, status: "draft", ...saved, ...data }] }) };
    },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  try {
    await patchHandler({ params: { projectId: "1", id: "4" }, body, user: { userId: 1 } }, res, () => {});
    return { response: res, update };
  } finally {
    delete globalThis.approvedDbSelectFixture;
    delete globalThis.approvedDbUpdateFixture;
  }
}
test("approved route requires explicit valid percentage and period work", async () => {
  for (const patch of [{ progressPercentage: null }, { progressPercentage: "" }, { progressPercentage: 101 }, { workDescription: " " }]) {
    assert.equal((await invoke({ ...base, ...patch })).code, 400);
  }
});
test("a future report draft saves without work text, percentage, or a projected snapshot", async () => {
  const { response, inserted } = await invokeCreate({
    type: "period",
    reportDate: "2099-12-20",
    periodStart: "2099-12-01",
    periodEnd: "2099-12-20",
  });
  assert.equal(response.code, 201);
  assert.equal(inserted.workDescription, "");
  assert.equal(inserted.progressPercentage, null);
  assert.equal(inserted.activitiesSnapshot, null);
  assert.equal(response.body.progressPercentage, null);
  assert.equal(response.body.activitiesSnapshot, null);
  assert.equal("forecastDraft" in response.body, false);
});
test("an ordinary report can be saved without work text but cannot be approved until completed", async () => {
  const { response, inserted } = await invokeCreate({
    type: "period",
    reportDate: "2000-01-02",
    periodStart: "2000-01-01",
    periodEnd: "2000-01-02",
    progressSource: "manual",
    progressPercentage: 42,
    workDescription: "   ",
  });
  assert.equal(response.code, 201);
  assert.equal(inserted.workDescription, "");
  assert.equal(response.body.status, "draft");
  assert.equal(response.body.progressPercentage, 42);

  const approval = await invokeStatus("approved", {
    status: "draft",
    reportDate: "2000-01-02",
    periodStart: "2000-01-01",
    periodEnd: "2000-01-02",
    workDescription: "",
    progressPercentage: 42,
  });
  assert.equal(approval.code, 409);
  assert.match(approval.body.error, /أكمل تواريخ الفترة ووصف الأعمال ونسبة الإنجاز/);
});
test("future report drafts cannot be approved until dates and report data are complete", async () => {
  const response = await invokeStatus("approved", {
    status: "draft", reportDate: "2099-12-20", periodStart: "2099-12-01",
    periodEnd: "2099-12-20", workDescription: "", progressPercentage: null,
  });
  assert.equal(response.code, 409);
  assert.match(response.body.error, /قبل حلول تاريخه/);
});
test("an incomplete ordinary draft remains blocked after dates are no longer future", async () => {
  const response = await invokeStatus("approved", {
    status: "draft", reportDate: "2000-01-02", periodStart: "2000-01-01",
    periodEnd: "2000-01-02", workDescription: "", progressPercentage: null,
  });
  assert.equal(response.code, 409);
  assert.match(response.body.error, /أكمل تواريخ الفترة ووصف الأعمال ونسبة الإنجاز/);
});
test("a complete current or past ordinary draft can be explicitly approved", async () => {
  const response = await invokeStatus("approved", {
    status: "draft", reportDate: "2000-01-02", periodStart: "2000-01-01",
    periodEnd: "2000-01-02", workDescription: "أعمال الفترة", progressPercentage: 42,
  });
  assert.equal(response.code, 200);
  assert.equal(response.body.status, "approved");
  assert.equal(response.body.progressPercentage, 42);
});
test("a future draft can be dated back and completed through ordinary manual progress entry", async () => {
  const { response, update } = await invokePatch({
    reportDate: "2000-01-02",
    periodStart: "2000-01-01",
    periodEnd: "2000-01-02",
    workDescription: "الأعمال المنفذة فعلياً",
    progressPercentage: 42,
    progressSource: "manual",
  });
  assert.equal(response.code, 200);
  assert.equal(update.reportDate, "2000-01-02");
  assert.equal(update.periodEnd, "2000-01-02");
  assert.equal(update.progressPercentage, 42);
  assert.equal(update.progressSource, "manual");
  assert.equal(update.activitiesSnapshot, undefined);
});
test("a report with a future period end cannot store a manual percentage or snapshot", async () => {
  const { response, update } = await invokePatch({
    reportDate: "2000-01-02",
    periodEnd: "2099-12-20",
    workDescription: "أعمال مستقبلية",
    progressPercentage: 42,
    progressSource: "manual",
  }, { periodStart: "2000-01-01", periodEnd: "2099-12-20" });
  assert.equal(response.code, 200);
  assert.equal(update.progressPercentage, null);
  assert.equal(update.progressSource, null);
  assert.equal(update.activitiesSnapshot, null);

  const snapshotAttempt = await invokePatch({
    reportDate: "2000-01-02",
    periodEnd: "2099-12-20",
    activitiesSnapshot: [{ id: 1, actualProgress: 100, status: "completed" }],
  }, { periodStart: "2000-01-01", periodEnd: "2099-12-20" });
  assert.equal(snapshotAttempt.response.code, 409);
});
test("future drafts in the reports list retain missing progress without forecast fields", async () => {
  const response = await invokeReportsList({
    id: 4, projectId: 1, reportNumber: 3, type: "period",
    reportDate: "2099-12-20", periodStart: "2099-12-01", periodEnd: "2099-12-20",
    workDescription: "", progressPercentage: null, imageGroups: null, status: "draft",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body[0].progressPercentage, null);
  assert.equal(response.body[0].status, "draft");
  assert.equal("forecastDraft" in response.body[0], false);
});
test("migration converts only legacy draft forecasts and clears projected values", () => {
  const migration = fs.readFileSync(new URL("../../../lib/db/migrations/0016_future_report_drafts.sql", import.meta.url), "utf8");
  assert.match(migration, /WHERE forecast_draft = true\s+AND status = 'draft'/);
  assert.match(migration, /WHEN progress_source = 'manual'/);
  assert.match(migration, /progress_percentage IS NOT NULL/);
  assert.match(migration, /progress_percentage = CASE/);
  assert.match(migration, /activities_snapshot = NULL/);
  assert.doesNotMatch(migration, /UPDATE activities/i);
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
      from: () => ({ where: async () => [{
        id: 3, reportDate: base.reportDate, periodStart: base.periodStart,
        periodEnd: base.periodEnd, snapshot: historicalRows,
      }] }),
    });
    const res = await invoke({ ...base, reportId: 3, workDescription: "" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.ok(prompts[0].includes('"actualProgressAsOfPeriodEnd":40'));
    const wrongPeriod = await invoke({ ...base, reportId: 3, periodEnd: "2026-10-01" });
    assert.equal(wrongPeriod.code, 409);
  });
});
test("AI drafting rejects report dates that have not been saved yet", async t => {
  await withPromptCapture(async prompts => {
    globalThis.approvedDbSelectFixture = () => ({
      from: () => ({ where: async () => [{
        id: 3,
        reportDate: base.reportDate,
        periodStart: base.periodStart,
        periodEnd: base.periodEnd,
        snapshot: historicalRows,
      }] }),
    });
    const res = await invoke({ ...base, reportId: 3, periodStart: "2026-09-02" });
    if (res.code === 503) { t.skip("No provider configured"); return; }
    assert.equal(res.code, 409);
    assert.match(res.body.error, /احفظ التواريخ قبل الصياغة/);
    assert.equal(prompts.length, 0);
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
      from: () => ({ where: async () => [{
        id: 3, reportDate: base.reportDate, periodStart: base.periodStart,
        periodEnd: base.periodEnd, snapshot: null,
      }] }),
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
      from: () => ({ where: async () => [{
        id: 3, reportDate: base.reportDate, periodStart: base.periodStart,
        periodEnd: base.periodEnd, snapshot: null,
      }] }),
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
