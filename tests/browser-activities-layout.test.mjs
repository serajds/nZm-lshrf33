import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const origin = process.env.ACTIVITIES_VISUAL_URL;
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
  if (path === "/api/projects") return [project];
  if (path === "/api/projects/1/suspensions" || path === "/api/companies" || path === "/api/notifications") return [];
  if (path === "/api/attendance/my-status") return { checkedIn: false };
  return [];
}

class Browser {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.pending = new Map();
    this.events = [];
    this.id = 0;
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) {
        if (message.method === "Runtime.exceptionThrown") this.events.push(message.params.exceptionDetails.text);
        if (message.method === "Fetch.requestPaused") {
          const { requestId, request } = message.params;
          const body = Buffer.from(JSON.stringify(fixtureFor(request.url))).toString("base64");
          void this.send("Fetch.fulfillRequest", {
            requestId, responseCode: 200, body,
            responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          }).catch((error) => this.events.push(error.message));
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error("Timed out waiting for the activities page");
}

test("activities layout is RTL and percentages fit on desktop, mobile and Gantt", { timeout: 90_000 }, async () => {
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
    await browser.send("Page.navigate", { url: `${origin}/projects/1/activities` });
    await waitFor(() => browser.evaluate('document.querySelector("[aria-label=\\"فهرس مجموعات بنود الأعمال\\"]")?.children.length > 5 && document.body.innerText.includes("10.8%")'));
    const measure = async () => browser.evaluate(`(() => {
      const grid = document.querySelector('[aria-label="فهرس مجموعات بنود الأعمال"]');
      const table = document.querySelector('[aria-label="جدول بنود الأعمال قابل للتمرير أفقياً"]');
      const mobileCard = [...document.querySelectorAll('div')].find(el => getComputedStyle(el).display !== 'none' && el.textContent?.includes('مخطط 40.4%') && el.textContent?.includes('فعلي 10.8%') && el.children.length < 5);
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
  } finally {
    browser?.close();
    if (chromium.exitCode === null) {
      chromium.kill("SIGTERM");
      await Promise.race([once(chromium, "exit"), delay(2000)]);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});