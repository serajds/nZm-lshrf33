// Opt-in browser regression for report-period progress auto-fill.
// NODE_ENV=development REPORT_AUTOFILL_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/report-period-progress-autofill.browser.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { Cdp, until } from "./helpers/deviation-browser.mjs";

test("new report auto-fills weighted progress from dated activity history", {
  skip: process.env.REPORT_AUTOFILL_BROWSER !== "1",
  timeout: 240_000,
}, async () => {
  // The test must never inherit either configured database connection.
  delete process.env.SOURCE_PRODUCTION_DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:1/not-used";
  const postgres = await isolatedPostgres();
  let server, vite, browser, cdp, profile, schema;
  let fixtureUser, fixtureProject;
  try {
    execFileSync("psql", [
      "--no-psqlrc", "--set", "ON_ERROR_STOP=1",
      "--dbname", process.env.DATABASE_URL,
      "-f", "lib/db/migrations/0008_project_progress_history.sql",
    ], { stdio: "pipe" });

    const [{ default: app }, dbSchema, { signToken }, { eq }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    schema = dbSchema;
    const {
      db, usersTable, projectsTable, activitiesTable, reportsTable,
      auditLogTable, projectProgressHistoryTable,
    } = dbSchema;

    const dateParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Tripoli",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const part = type => dateParts.find(item => item.type === type).value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const offsetDate = days => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000)
      .toISOString().slice(0, 10);

    [fixtureUser] = await db.insert(usersTable).values({
      phone: `report-fixture-${Date.now()}`,
      passwordHash: "unused",
      fullName: "Temporary report fixture",
      role: "admin",
    }).returning();
    [fixtureProject] = await db.insert(projectsTable).values({
      name: "اختبار مؤقت لنسبة التقرير التلقائية",
      location: "اختبار معزول",
      ownerEntity: "اختبار",
      supervisorEntity: "اختبار",
      contractor: "اختبار",
      startDate: offsetDate(-30),
      expectedEndDate: offsetDate(30),
    }).returning();

    const activities = await db.insert(activitiesTable).values([
      { projectId: fixtureProject.id, name: "بند اختبار 20%", plannedStartDate: offsetDate(-30), plannedEndDate: offsetDate(30), actualProgress: 0, weight: 1, sortOrder: 1 },
      { projectId: fixtureProject.id, name: "بند اختبار 50%", plannedStartDate: offsetDate(-30), plannedEndDate: offsetDate(30), actualProgress: 0, weight: 2, sortOrder: 2 },
      { projectId: fixtureProject.id, name: "بند اختبار 80%", plannedStartDate: offsetDate(-30), plannedEndDate: offsetDate(30), actualProgress: 0, weight: 1, sortOrder: 3 },
    ]).returning();
    for (const [index, actualProgress] of [20, 50, 80].entries()) {
      await db.update(activitiesTable)
        .set({ actualProgress, status: "in_progress" })
        .where(eq(activitiesTable.id, activities[index].id));
    }

    server = createServer(app).listen(0, "127.0.0.1");
    await once(server, "listening");
    const apiOrigin = `http://127.0.0.1:${server.address().port}`;
    const token = signToken({
      userId: fixtureUser.id,
      phone: fixtureUser.phone,
      role: fixtureUser.role,
    });
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const progressResponse = await fetch(
      `${apiOrigin}/api/projects/${fixtureProject.id}/reports/progress-as-of?periodEnd=${today}`,
      { headers },
    );
    assert.equal(progressResponse.status, 200);
    const progress = await progressResponse.json();
    assert.equal(progress.available, true);
    assert.equal(progress.overallProgress, 50);
    assert.equal(progress.activitiesCount, 3);

    const { createServer: createVite } = await import("../artifacts/construction-supervision/node_modules/vite/dist/node/index.js");
    const previousPort = process.env.PORT;
    process.env.PORT = "5000";
    vite = await createVite({
      root: resolve("artifacts/construction-supervision"),
      configFile: resolve("artifacts/construction-supervision/vite.config.ts"),
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        proxy: { "/api": { target: apiOrigin, changeOrigin: true } },
      },
    });
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    await vite.listen();

    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const debugPort = probe.address().port;
    await new Promise(resolvePromise => probe.close(resolvePromise));
    profile = await mkdtemp(join(tmpdir(), "report-autofill-browser-"));
    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore" });

    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then(response => response.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await once(cdp.ws, "open");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("auth_token", ${JSON.stringify(token)}); localStorage.setItem("pwa-install-dismissed-at", String(Date.now()));`,
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send("Page.navigate", {
      url: `http://127.0.0.1:${vite.httpServer.address().port}/projects/${fixtureProject.id}/reports`,
    });
    await until(() => cdp.eval(
      `document.body?.innerText.includes(${JSON.stringify(fixtureProject.name)}) && [...document.querySelectorAll("button")].some(b => b.textContent.includes("إضافة تقرير"))`,
    ));
    await cdp.eval(`([...document.querySelectorAll("button")].find(b => b.textContent.includes("إضافة تقرير"))).click()`);
    await until(() => cdp.eval(`!!document.querySelector('[role="dialog"] #new-report-period-progress')`));

    const setLabeledValue = (labelText, value, elementType) => cdp.eval(`(() => {
      const label = [...document.querySelectorAll('[role="dialog"] label')]
        .find(item => item.textContent.trim().includes(${JSON.stringify(labelText)}));
      if (!label) throw new Error("missing labeled field: " + ${JSON.stringify(labelText)});
      const input = document.getElementById(label.htmlFor);
      if (!input) throw new Error("missing associated input: " + ${JSON.stringify(labelText)});
      const prototype = ${JSON.stringify(elementType)} === "textarea"
        ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.value;
    })()`);

    await setLabeledValue("تاريخ التقرير", today, "input");
    await setLabeledValue("بداية الفترة", today, "input");
    await setLabeledValue("نهاية الفترة", today, "input");
    await setLabeledValue("وصف الأعمال المنجزة خلال الفترة", "اختبار مؤقت للتحقق من النسبة التلقائية.", "textarea");
    await until(() => cdp.eval(
      `document.querySelector("#new-report-period-progress")?.value === "50" && document.querySelector("#new-report-period-progress")?.disabled === true`,
    ));
    const autoField = await cdp.eval(`({
      value: document.querySelector("#new-report-period-progress").value,
      disabled: document.querySelector("#new-report-period-progress").disabled,
      help: document.querySelector("#new-report-period-progress-help").innerText
    })`);
    assert.equal(autoField.value, "50");
    assert.match(autoField.help, /محتسب من سجل/);
    assert.deepEqual(cdp.errors, []);

    await cdp.eval(`(() => {
      const button = [...document.querySelectorAll('[role="dialog"] button[type="submit"]')]
        .find(item => item.textContent.includes("إنشاء التقرير"));
      if (!button || button.disabled) throw new Error("report submit button is not ready");
      button.click();
    })()`);
    let savedReports = [];
    await until(async () => {
      const response = await fetch(`${apiOrigin}/api/projects/${fixtureProject.id}/reports`, { headers });
      if (!response.ok) return false;
      savedReports = await response.json();
      return savedReports.length === 1;
    });
    assert.deepEqual(cdp.errors, []);
    const savedReport = savedReports[0];
    assert.equal(savedReport.progressPercentage, 50);
    assert.equal(savedReport.progressSource, "history");
    assert.equal(savedReport.progressAsOfDate, today);
    await until(() => cdp.eval(`document.body.innerText.includes("50%")`));

    console.log(JSON.stringify({
      fixtureDatabase: "isolated development test database",
      weightedActivities: [{ progress: 20, weight: 1 }, { progress: 50, weight: 2 }, { progress: 80, weight: 1 }],
      endpointPercent: progress.overallProgress,
      automaticallyFilledField: autoField.value,
      createdReportPercent: savedReport.progressPercentage,
      reportSource: savedReport.progressSource,
      reportDate: savedReport.progressAsOfDate,
      projectWasTemporary: true,
    }));
  } finally {
    if (fixtureProject && schema) {
      const { db, auditLogTable, reportsTable, activitiesTable, projectProgressHistoryTable, projectsTable } = schema;
      const { eq } = await import("../lib/db/node_modules/drizzle-orm/index.js");
      await db.delete(auditLogTable).where(eq(auditLogTable.projectId, fixtureProject.id));
      await db.delete(reportsTable).where(eq(reportsTable.projectId, fixtureProject.id));
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, fixtureProject.id));
      await db.delete(projectProgressHistoryTable).where(eq(projectProgressHistoryTable.projectId, fixtureProject.id));
      await db.delete(projectsTable).where(eq(projectsTable.id, fixtureProject.id));
    }
    if (fixtureUser && schema) {
      const { eq } = await import("../lib/db/node_modules/drizzle-orm/index.js");
      await schema.db.delete(schema.usersTable).where(eq(schema.usersTable.id, fixtureUser.id));
    }
    cdp?.ws.close();
    if (browser) {
      browser.kill("SIGTERM");
      if (browser.exitCode == null) await once(browser, "exit");
    }
    if (vite) await vite.close();
    if (server) await new Promise(resolvePromise => server.close(resolvePromise));
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    if (schema?.pool) await schema.pool.end();
    await postgres.stop();
  }
});
