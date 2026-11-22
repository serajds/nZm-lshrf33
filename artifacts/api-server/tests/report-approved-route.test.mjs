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
      b.onResolve({ filter: /\/report-forecast$/ }, () => ({ path: "forecast", namespace: "forecast-fixture" }));
      b.onLoad({ filter: /.*/, namespace: "forecast-fixture" }, () => ({
        contents: `export const getReportForecastProgress = async (...args) =>
          globalThis.approvedForecastFixture?.(...args) ?? {
            forecastDraft:true, targetDate:args[1], today:"2026-11-22",
            actualAsOfDate:args[1], actualAvailable:false, actualProgress:null,
            plannedProgress:60, plannedSource:"project_schedule", actualSource:"unavailable", activities:[],
          };`,
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
let handler, patchHandler, statusHandler, reportsListHandler;
try {
  const { default: router } = await import(path);
  handler = router.stack.find(layer => layer.route?.path === "/projects/:projectId/reports/ai-draft")
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
async function invokePatchMaturedForecast(body, storedPeriodEnd = "2026-10-20", source = null) {
  let update;
  globalThis.approvedDbSelectFixture = () => ({
    from: () => ({ where: async () => [{
      source, periodEnd: storedPeriodEnd, reportDate: storedPeriodEnd,
      percentage: 0, forecastDraft: true, status: "draft",
    }] }),
  });
  globalThis.approvedDbUpdateFixture = () => ({
    set: data => {
      update = data;
      return {
        where: () => ({ returning: async () => [{ id: 1, projectId: 1, reportNumber: 6, reportDate: body.reportDate ?? "2026-10-20", periodEnd: body.periodEnd ?? storedPeriodEnd, status: "draft", ...data }] }),
      };
    },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  try {
    await patchHandler({
      params: { projectId: "1", id: "6" },
      body,
      user: { userId: 1 },
    }, res, () => {});
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
test("future forecast drafts cannot be approved before their target date", async () => {
  const response = await invokeStatus("approved", {
    status: "draft", forecastDraft: true, periodEnd: "2026-12-20", progressSource: null,
  });
  assert.equal(response.code, 409);
  assert.match(response.body.error, /توقع وليست تقرير إنجاز فعلياً/);
});
test("matured forecast drafts approve with historical actuals and become ordinary reports", async () => {
  globalThis.approvedForecastFixture = async (_projectId, targetDate) => ({
    forecastDraft: true, targetDate, today: "2026-11-22",
    actualAsOfDate: targetDate, actualAvailable: true, actualProgress: 47,
    plannedProgress: 70, plannedSource: "project_schedule", actualSource: "history", activities: [{ id: 1, actualProgress: 47 }],
  });
  try {
    const response = await invokeStatus("approved", {
      status: "draft", forecastDraft: true, periodEnd: "2026-10-20", progressSource: null,
    });
    assert.equal(response.code, 200);
    assert.equal(response.body.progressPercentage, 47);
    assert.equal(response.body.progressSource, "history");
    assert.equal(response.body.forecastDraft, false);
    assert.equal(response.body.status, "approved");
  } finally {
    delete globalThis.approvedForecastFixture;
  }
});
test("matured forecast approval preserves reviewed estimated-history provenance", async () => {
  globalThis.approvedForecastFixture = async (_projectId, targetDate) => ({
    forecastDraft: true, targetDate, today: "2026-11-22",
    actualAsOfDate: targetDate, actualAvailable: true, actualProgress: 39.6,
    plannedProgress: null, plannedSource: "project_schedule", actualSource: "estimated_history",
    activities: [{ id: 1, actualProgress: null, actualHistoricalUnverified: true }],
  });
  try {
    const response = await invokeStatus("approved", {
      status: "draft", forecastDraft: true, periodEnd: "2026-10-20", progressSource: null,
    });
    assert.equal(response.code, 200);
    assert.equal(response.body.progressPercentage, 39.6);
    assert.equal(response.body.progressSource, "history");
    assert.equal(response.body.progressHistorySource, "estimated");
    assert.equal(response.body.activitiesSnapshot[0].actualProgress, null);
    assert.equal(response.body.forecastDraft, false);
  } finally {
    delete globalThis.approvedForecastFixture;
  }
});

test("matured forecast drafts require documented input when historical actuals are unavailable", async () => {
  const response = await invokeStatus("approved", {
    status: "draft", forecastDraft: true, periodEnd: "2026-10-20", progressSource: null,
  });
  assert.equal(response.code, 409);
  assert.match(response.body.error, /أدخل النسبة الفعلية الموثقة/);
});
test("matured forecast appears as a normal draft with its dated historical percentage", async () => {
  globalThis.approvedForecastFixture = async (_projectId, targetDate) => ({
    forecastDraft: true, targetDate, today: "2026-11-22",
    actualAsOfDate: targetDate, actualAvailable: true, actualProgress: 47,
    plannedProgress: 70, plannedSource: "project_schedule", actualSource: "history", activities: [],
  });
  try {
    const response = await invokeReportsList({
      id: 1, projectId: 1, reportNumber: 4, type: "period",
      reportDate: "2026-10-20", periodStart: "2026-10-01", periodEnd: "2026-10-20",
      workDescription: "أعمال الفترة", progressPercentage: 0,
      imageGroups: null, forecastDraft: true, progressSource: null, status: "draft",
    });
    assert.equal(response.code, 200);
    assert.equal(response.body[0].forecastDraft, false);
    assert.equal(response.body[0].forecastMatured, true);
    assert.equal(response.body[0].actualAvailable, true);
    assert.equal(response.body[0].progressPercentage, 47);
    assert.equal(response.body[0].progressSource, "history");
  } finally {
    delete globalThis.approvedForecastFixture;
  }
});
test("matured forecast list preserves a reviewed estimated aggregate and its source", async () => {
  globalThis.approvedForecastFixture = async (_projectId, targetDate) => ({
    forecastDraft: true, targetDate, today: "2026-11-22",
    actualAsOfDate: targetDate, actualAvailable: true, actualProgress: 39.6,
    plannedProgress: null, plannedSource: "unavailable", actualSource: "estimated_history", activities: [],
  });
  try {
    const response = await invokeReportsList({
      id: 1, projectId: 1, reportNumber: 5, type: "period",
      reportDate: "2026-11-20", periodStart: "2026-09-22", periodEnd: "2026-11-20",
      workDescription: "أعمال الفترة", progressPercentage: 0,
      imageGroups: null, forecastDraft: true, progressSource: null, status: "draft",
    });
    assert.equal(response.code, 200);
    assert.equal(response.body[0].forecastDraft, false);
    assert.equal(response.body[0].actualAvailable, true);
    assert.equal(response.body[0].progressPercentage, 39.6);
    assert.equal(response.body[0].progressHistorySource, "estimated");
  } finally {
    delete globalThis.approvedForecastFixture;
  }
});

test("matured forecast with no history stays a normal draft marked for actual entry", async () => {
  const response = await invokeReportsList({
    id: 1, projectId: 1, reportNumber: 5, type: "period",
    reportDate: "2026-10-20", periodStart: "2026-10-01", periodEnd: "2026-10-20",
    workDescription: "أعمال الفترة", progressPercentage: 0,
    imageGroups: null, forecastDraft: true, progressSource: null, status: "draft",
  });
  assert.equal(response.code, 200);
  assert.equal(response.body[0].forecastDraft, false);
  assert.equal(response.body[0].forecastMatured, true);
  assert.equal(response.body[0].actualAvailable, false);
  assert.equal(response.body[0].progressPercentage, 0);
});
test("matured forecast accepts a documented percentage through ordinary report editing", async () => {
  const { response, update } = await invokePatchMaturedForecast({
    progressPercentage: 42, progressSource: "manual", workDescription: "الأعمال المنفذة فعلياً",
  });
  assert.equal(response.code, 200);
  assert.equal(update.progressPercentage, 42);
  assert.equal(update.progressSource, "manual");
  assert.equal(update.forecastDraft, undefined);
});
test("a future draft edited to a past date uses the ordinary documented-progress path", async () => {
  const targetDate = "2026-10-20";
  const { response, update } = await invokePatchMaturedForecast({
    reportDate: targetDate, periodEnd: targetDate,
    progressPercentage: 42, progressSource: "manual", workDescription: "الأعمال المنفذة فعلياً",
  }, "2026-12-20");
  assert.equal(response.code, 200);
  assert.equal(update.progressPercentage, 42);
  assert.equal(update.progressSource, "manual");
});
test("changing a matured draft date clears manual actuals when the new date has no history", async () => {
  const targetDate = "2026-10-20";
  const { response, update } = await invokePatchMaturedForecast({
    reportDate: targetDate, periodEnd: targetDate,
    workDescription: "تحديث الفترة",
  }, "2026-10-10", "manual");
  assert.equal(response.code, 200);
  assert.equal(update.progressPercentage, 0);
  assert.equal(update.progressSource, null);
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
