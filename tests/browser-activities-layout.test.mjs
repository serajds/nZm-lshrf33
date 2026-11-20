import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

let origin = process.env.ACTIVITIES_VISUAL_URL;
const user = { id: 1, role: "admin", fullName: "مستخدم تجريبي", phone: "0000000000" };
const project = { id: 1, name: "مشروع اختبار العرض", status: "active", startDate: "2026-01-01", expectedEndDate: "2026-12-31" };
const groups = Array.from({ length: 7 }, (_, i) => ({
  id: i + 101, projectId: 1, name: `مجموعة الأعمال الإنشائية رقم ${i + 1}`,
  color: "#2563eb", sortOrder: i,
}));
const activities = groups.map((group, i) => ({
  id: i + 201, projectId: 1, groupId: group.id, name: `بند تنفيذ الأعمال ${i + 1}`,
  plannedProgress: 40.430769230769236, actualProgress: 10.769230769230769,
  status: "in_progress", weight: 1, sortOrder: i,
  plannedStartDate: "2026-01-01", plannedEndDate: "2026-11-01",
  actualStartDate: "2026-03-01", actualEndDate: null,
}));

function fixtureFor(url) {
  const path = new URL(url).pathname;
  if (path === "/api/auth/me") return user;
  if (path === "/api/projects/1") return project;
  if (path === "/api/projects/1/activities") return activities;
  if (path === "/api/projects/1/activity-groups") return groups;
  if (path === "/api/projects/1/my-permissions") return { canEditAll: true, isViewer: false, projectRole: "admin" };
  if (path === "/api/projects/1/progress-history-backfill") {
    return { project, activities: [], batches: [], fingerprint: "visual-test" };
  }
  if (path === "/api/projects") return [project];
  if (path === "/api/projects/1/suspensions" || path === "/api/companies" || path === "/api/notifications") return [];
  if (path === "/api/attendance/my-status") return [{ projectId: 1, currentlyCheckedIn: false }];
  if (path === "/api/projects/1/summary") return { overallProgress: 10.8, plannedProgress: 40.4, recentReports: [], activitiesTotal: 7 };
  if (path === "/api/dashboard/summary") return { allProjects: [], recentProjects: [], recentReports: [], delayedActivities: [] };
  if (path === "/api/attendance/projects/1/active") return { activeCount: 0, members: [] };
  return [];
}

class Browser {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.events = [];
    this.requests = [];
    this.delayMs = 0;
    this.failCategories = false;
    this.id = 0;
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") this.events.push(message.params.exceptionDetails.text);
        if (message.method === "Fetch.requestPaused") {
          const { requestId, request } = message.params;
          this.requests.push({ path: new URL(request.url).pathname, method: request.method });
          if (this.failCategories && request.url.includes("activity-group-categories")) {
            void this.send("Fetch.fulfillRequest", { requestId, responseCode: 403,
              body: Buffer.from('{"error":"forbidden"}').toString("base64"),
              responseHeaders: [{ name: "Content-Type", value: "application/json" }] });
            return;
          }
          const body = Buffer.from(JSON.stringify(fixtureFor(request.url))).toString("base64");
          void delay(this.delayMs).then(() => this.send("Fetch.fulfillRequest", {
            requestId, responseCode: 200, body,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          })).catch((error) => this.events.push(error.message));
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async open() { await once(this.socket, "open"); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async screenshot(file) {
    const result = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(file, Buffer.from(result.data, "base64"));
  }
  close() { this.socket.close(); }
}

async function waitFor(check) {
  for (let i = 0; i < 200; i++) {
    let result;
    try { result = await check(); }
    catch (error) {
      if (!/context.*(destroyed|not found)|Cannot find context/i.test(error.message)) throw error;
    }
    if (result) return result;
    await delay(100);
  }
  throw new Error("Timed out waiting for the activities page");
}

test("activities layout is RTL and percentages fit on desktop, mobile and Gantt", { timeout: 90_000 }, async () => {
  let fixtureServer;
  const baselineRef = process.env.ACTIVITIES_BASELINE_REF;
  if (process.env.ACTIVITIES_ISOLATED === "1") {
    const { createServer } = await import("../artifacts/construction-supervision/node_modules/vite/dist/node/index.js");
    const root = path.resolve("artifacts/construction-supervision");
    const original = new Map();
    if (baselineRef) {
      for (const relative of ["App.tsx", "main.tsx", "pages/projects/[id]/activities.tsx", "pages/projects/[id].tsx",
        "pages/projects/[id]/attendance.tsx", "components/attendance-quick-actions.tsx", "lib/offline-attendance.ts"]) {
        const filename = `${root}/src/${relative}`;
        original.set(filename, execFileSync("git", ["show", `${baselineRef}:${path.relative(process.cwd(), filename)}`], { encoding: "utf8" }));
      }
    }
    fixtureServer = await createServer({
      root, configFile: `${root}/vite.config.ts`, logLevel: "error",
      plugins: [{ name: "exact-frontend-baseline", enforce: "pre",
        load(id) { return original.get(id.split("?")[0]); } }],
      server: { host: "127.0.0.1", port: 0, hmr: false, open: false },
    });
    await fixtureServer.listen();
    origin = `http://127.0.0.1:${fixtureServer.httpServer.address().port}`;
  }
  assert.ok(origin, "Set ACTIVITIES_VISUAL_URL to the running web preview URL");
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const profile = await mkdtemp(join(tmpdir(), "activities-visual-"));
  const chromium = spawn("/repl/tools/bin/chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let browser;
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
    browser = new Browser(target.webSocketDebuggerUrl);
    await browser.open();
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/*", requestStage: "Request" }] });
    await browser.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `if (location.protocol === "http:") {
        localStorage.setItem("auth_token", "visual-test-only");
        localStorage.setItem("auth_user_cache", JSON.stringify({token:"visual-test-only",user:${JSON.stringify(user)}}));
      }`,
    });
    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const start = performance.now();
    await browser.send("Page.navigate", { url: `${origin}/projects/1/activities` });
    await waitFor(() => browser.evaluate('document.querySelector("[aria-label=\\"فهرس مجموعات بنود الأعمال\\"]")?.children.length > 5 && document.body.innerText.includes("10.8%")'));
    const initialRenderMs = performance.now() - start;
    const initialRequests = [...browser.requests];
    const initialResources = await browser.evaluate(`performance.getEntriesByType("resource").map(r => ({
      name: new URL(r.name).pathname, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, duration: r.duration
    }))`);
    const initialMeasurement = { label: baselineRef ? "before" : "after", initialRenderMs, initialRequests, resources: initialResources };
    await mkdir("generated-artifacts", { recursive: true });
    await writeFile(`generated-artifacts/performance-browser-${initialMeasurement.label}.json`, JSON.stringify(initialMeasurement, null, 2));
    if (process.env.ACTIVITIES_MEASURE_ONLY === "1") {
      console.log("PAGE_BASELINE", JSON.stringify({ ...initialMeasurement, resources: {
        count: initialResources.length,
        transferBytes: initialResources.reduce((sum, r) => sum + r.transferSize, 0),
        encodedBodyBytes: initialResources.reduce((sum, r) => sum + r.encodedBodySize, 0),
      } }));
      return;
    }
    const measure = async () => browser.evaluate(`(() => {
      const grid = document.querySelector('[aria-label="فهرس مجموعات بنود الأعمال"]');
      const table = document.querySelector('[aria-label="جدول بنود الأعمال قابل للتمرير أفقياً"]');
      const mobileCard = [...document.querySelectorAll('div')].find(el => getComputedStyle(el).display !== 'none' && el.textContent?.includes('مخطط 40.4%') && el.textContent?.includes('فعلي 10.8%') && el.children.length < 5);
      if (!grid) return {
        width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        gridPresent: false, visibleLabels: [...document.querySelectorAll('[aria-label]')].slice(0, 20).map(el => el.getAttribute('aria-label')),
        bodyText: document.body.innerText.slice(0, 500),
      };
      const shown = table && getComputedStyle(table).display !== 'none';
      const percentCells = shown ? [...table.querySelectorAll('td')].filter(td => td.textContent?.includes('10.8%')) : [];
      return {
        width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        gridWidth: grid.getBoundingClientRect().width,
        parentWidth: grid.parentElement.getBoundingClientRect().width,
        rtl: getComputedStyle(grid).direction,
        firstCardRight: grid.firstElementChild.getBoundingClientRect().right,
        gridRight: grid.getBoundingClientRect().right,
        tableVisible: shown,
        hasRoundedRows: shown ? table.textContent.includes('40.4%') && table.textContent.includes('-29.7%') : Boolean(mobileCard),
        hasRawRows: shown ? table.textContent.includes('10.769230769230769') : document.body.innerText.includes('10.769230769230769'),
        overflowingCells: percentCells.filter(td => [...td.querySelectorAll('span[dir="ltr"],bdi[dir="ltr"]')].some(el => el.getBoundingClientRect().right > td.getBoundingClientRect().right + 1 || el.getBoundingClientRect().left < td.getBoundingClientRect().left - 1)).length,
      };
    })()`);
    const desktop = await measure();
    assert.equal(desktop.rtl, "rtl");
    assert.ok(desktop.columns >= 3, JSON.stringify(desktop));
    assert.ok(desktop.gridWidth >= desktop.parentWidth * 0.95, JSON.stringify(desktop));
    assert.ok(Math.abs(desktop.firstCardRight - desktop.gridRight) < 3, JSON.stringify(desktop));
    assert.ok(desktop.hasRoundedRows && !desktop.hasRawRows && !desktop.overflowingCells, JSON.stringify(desktop));
    assert.ok(desktop.scrollWidth <= desktop.width + 1, JSON.stringify(desktop));
    await browser.evaluate('document.querySelector("[aria-label=\\"فهرس مجموعات بنود الأعمال\\"]").scrollIntoView()');
    await browser.screenshot("/tmp/activities-desktop-groups.png");
    await browser.evaluate('document.querySelector("[aria-label=\\"جدول بنود الأعمال قابل للتمرير أفقياً\\"]").scrollIntoView()');
    await browser.screenshot("/tmp/activities-desktop-rows.png");

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(300);
    const mobile = await measure();
    assert.equal(mobile.columns, 1, JSON.stringify(mobile));
    assert.ok(mobile.hasRoundedRows && !mobile.hasRawRows, JSON.stringify(mobile));
    assert.ok(mobile.scrollWidth <= mobile.width + 1, JSON.stringify(mobile));
    await browser.evaluate('document.querySelector("[aria-label=\\"فهرس مجموعات بنود الأعمال\\"]").scrollIntoView()');
    await browser.screenshot("/tmp/activities-mobile-groups.png");
    await browser.evaluate('document.querySelector(".md\\\\:hidden [class*=space-y-2]")?.scrollIntoView()');
    await browser.screenshot("/tmp/activities-mobile-rows.png");

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 720, deviceScaleFactor: 1, mobile: true });
    await delay(250);
    const narrowMobile = await measure();
    assert.equal(narrowMobile.columns, 1, JSON.stringify(narrowMobile));
    assert.ok(narrowMobile.scrollWidth <= narrowMobile.width + 1, JSON.stringify(narrowMobile));

    await browser.evaluate('[...document.querySelectorAll("button")].find(b => b.textContent?.includes("جانت"))?.click()');
    await waitFor(() => browser.evaluate('document.body.innerText.includes("مخطط Gantt - الجدول الزمني")'));
    const gantt = await measure();
    assert.ok(gantt.scrollWidth <= gantt.width + 1, JSON.stringify(gantt));
    assert.ok(await browser.evaluate('document.body.innerText.includes("10.8%")'));

    await browser.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await delay(250);
    const desktopGantt = await measure();
    assert.ok(desktopGantt.columns >= 3, JSON.stringify(desktopGantt));
    assert.ok(desktopGantt.scrollWidth <= desktopGantt.width + 1, JSON.stringify(desktopGantt));
    await browser.evaluate('document.querySelector("[aria-label=\\"المخطط الزمني قابل للتمرير أفقياً\\"]")?.scrollIntoView()');
    await browser.screenshot("/tmp/activities-desktop-gantt.png");
    assert.deepEqual(browser.events, []);
    console.log({ desktop, mobile, narrowMobile, gantt: { width: gantt.width, scrollWidth: gantt.scrollWidth }, desktopGantt });
    const navigate = async route => {
      await browser.evaluate(`(() => {
        history.pushState(null, "", ${JSON.stringify(route)});
        dispatchEvent(new PopStateEvent("popstate"));
      })()`);
      await delay(600);
    };
    const beforeReturn = browser.requests.filter(r => r.path === "/api/projects/1/activities").length;
    await navigate("/projects/1/reports");
    await waitFor(() => browser.evaluate('document.body.innerText.includes("إنشاء تقرير") || document.body.innerText.includes("التقارير")'));
    await navigate("/projects/1/activities");
    assert.equal(browser.requests.filter(r => r.path === "/api/projects/1/activities").length, beforeReturn,
      "returning to a fresh cached activities query must not issue another network read");
    await navigate("/projects/1/attendance");
    await waitFor(() => browser.evaluate('document.body.innerText.includes("حضور وانصراف الطاقم")'));
    await navigate("/projects/1");
    await waitFor(() => browser.evaluate('document.body.innerText.includes("نسبة الإنجاز") || document.body.innerText.includes("ملخص المشروع")'));
    await navigate("/dashboard");
    await navigate("/projects/1/activities");
    assert.deepEqual(browser.events, []);
    const journeys = [...browser.requests];
    await browser.send("Network.enable");
    await browser.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await waitFor(() => browser.evaluate('document.body.innerText.includes("لا يوجد اتصال بالشبكة")'));
    assert.equal(await browser.evaluate('document.body.innerText.includes("10.8%")'), true);
    await browser.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await waitFor(() => browser.evaluate('!document.body.innerText.includes("لا يوجد اتصال بالشبكة")'));

    // Cold failed helper query: do not turn a permission rejection into a
    // successful empty classification list or retry it automatically.
    browser.failCategories = true;
    browser.delayMs = 900;
    const categoryBefore = browser.requests.filter(r => r.path.endsWith("activity-group-categories")).length;
    await browser.send("Page.reload", { ignoreCache: true });
    await waitFor(() => browser.evaluate('document.body?.innerText.includes("تعذر تحديث بعض البيانات")'));
    await delay(1400);
    assert.equal(browser.requests.filter(r => r.path.endsWith("activity-group-categories")).length, categoryBefore + 1);
    assert.equal(await browser.evaluate('document.body.innerText.includes("التصنيفات")'), true);
    browser.failCategories = false;
    browser.delayMs = 0;
    await browser.evaluate(`(() => {
      const alert = [...document.querySelectorAll('[role="alert"]')].find(el => el.textContent.includes("تعذر تحديث"));
      alert?.querySelector("button")?.click();
    })()`);
    await waitFor(() => browser.evaluate('!document.body.innerText.includes("تعذر تحديث بعض البيانات")'));
    browser.delayMs = 11000;
    await browser.send("Page.reload", { ignoreCache: true });
    await waitFor(() => browser.evaluate('document.body?.innerText.includes("جارٍ تحميل البنود")'));
    assert.equal(await browser.evaluate(`(() => {
      const section = document.querySelector('[aria-labelledby="activities-overview"]');
      return section?.querySelector(".tabular-nums.text-2xl")?.textContent === "—";
    })()`), true);
    await waitFor(() => browser.evaluate('document.body.innerText.includes("ما زال تحميل بعض البيانات جارياً")'));
    await waitFor(() => browser.evaluate('document.body.innerText.includes("10.8%")'));
    browser.delayMs = 0;
    const resources = await browser.evaluate(`performance.getEntriesByType("resource").map(r => ({
      name: new URL(r.name).pathname, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, duration: r.duration
    }))`);
    const measurement = { initialRenderMs, initialRequests, journeys, resources };
    await mkdir("generated-artifacts", { recursive: true });
    await writeFile("generated-artifacts/performance-browser.json", JSON.stringify(measurement, null, 2));
    console.log("PERFORMANCE_BROWSER", JSON.stringify({ initialRenderMs, initialRequests, journeys,
      resourceCount: resources.length, transferBytes: resources.reduce((sum, r) => sum + r.transferSize, 0) }));
  } finally {
    browser?.close();
    if (chromium.exitCode === null) {
      chromium.kill("SIGTERM");
      await Promise.race([once(chromium, "exit"), delay(2000)]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (fixtureServer) await fixtureServer.close();
  }
});