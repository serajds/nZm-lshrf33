import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.errors = [];
    this.ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.method === "Runtime.exceptionThrown") this.errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      if (!m.id) return;
      const p = this.pending.get(m.id); this.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}
export async function until(fn, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let error;
  while (Date.now() < deadline) {
    try { if (await fn()) return; } catch (e) { error = e; }
    await delay(100);
  }
  if (error) throw error;
  throw new Error("Browser condition timed out");
}

/** Real app + real HTTP/database fixtures; authentication is never bypassed. */
export async function verifyDeviationBrowser(apiOrigin, projectId, token, missingProjectId) {
  const { createServer: createVite } = await import("../../artifacts/construction-supervision/node_modules/vite/dist/node/index.js");
  const previousPort = process.env.PORT; process.env.PORT = "5000";
  const vite = await createVite({
    root: resolve("artifacts/construction-supervision"),
    configFile: resolve("artifacts/construction-supervision/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false, proxy: { "/api": { target: apiOrigin, changeOrigin: true } } },
  });
  if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const debugPort = probe.address().port; await new Promise(r => probe.close(r));
  const profile = await mkdtemp(join(tmpdir(), "deviation-browser-"));
  let browser, cdp;
  try {
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
    cdp = new Cdp(target.webSocketDebuggerUrl); await once(cdp.ws, "open"); await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("auth_token", ${JSON.stringify(token)}); localStorage.setItem("pwa-install-dismissed-at", String(Date.now()));`,
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `${origin}/projects/${projectId}/deviation` });
    await until(() => cdp.eval('document.body?.innerText.includes("كيف يُحسب الانحراف")'));
    assert.deepEqual(cdp.errors, []);
    assert(await cdp.eval('document.querySelectorAll("tbody tr").length === 50'));
    assert(await cdp.eval('document.body.innerText.includes("القراءة الحية الآن")'));
    await mkdir("generated-artifacts/deviation", { recursive: true });
    const screenshot = async name => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      await writeFile(`generated-artifacts/deviation/${name}.png`, Buffer.from(data, "base64"));
    };
    await screenshot("desktop");
    await cdp.eval(`[...document.querySelectorAll("h2,h3")].find(e => e.textContent.includes("مسار الإنجاز")).scrollIntoView({block:"start"})`);
    await delay(250); await screenshot("desktop-timeline");
    // Search is tested through React's native input event, not a DOM-only value change.
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="ابحث باسم البند"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "بند محلي");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await until(() => cdp.eval('document.querySelectorAll("tbody tr").length === 1'));
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="ابحث باسم البند"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await until(() => cdp.eval('document.querySelectorAll("tbody tr").length === 50'));
    await cdp.eval(`document.querySelector('button[aria-label="التالي"]').click()`);
    await until(() => cdp.eval('document.body.innerText.includes("2 / 2")'));
    await cdp.eval(`document.querySelector('button[aria-label="السابق"]').click()`);
    await cdp.eval(`(() => {
      const input = document.querySelector('input[placeholder="ابحث باسم البند"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "بند مرتبط محفوظ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await until(() => cdp.eval('document.querySelectorAll("tbody tr").length === 1 && !!document.querySelector("tbody button")'));
    // Source rows expand without an extra API request.
    const expand = await cdp.eval(`(() => {
      const b = [...document.querySelectorAll("tbody button")].find(b => b.getAttribute("aria-expanded") === "false");
      if (!b) return false; b.click(); return true;
    })()`);
    assert(expand, "linked source expansion button exists");
    await until(() => cdp.eval('document.body.innerText.includes("عنصر مصدر موثق")'));
    await cdp.eval(`document.querySelector("table").scrollIntoView({block:"center"})`);
    await delay(150); await screenshot("desktop-source-details");
    // Sort the current result; the clickable header preserves the source detail.
    await cdp.eval(`[...document.querySelectorAll("th button")].find(b => b.textContent.includes("الفعلي")).click()`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(400);
    assert(await cdp.eval("document.documentElement.scrollWidth <= innerWidth + 1"), "no horizontal page overflow on phone");
    await screenshot("mobile");
    await cdp.eval('document.documentElement.classList.add("dark")'); await delay(200); await screenshot("mobile-dark");
    await cdp.eval(`document.querySelector(".page-hero").scrollIntoView({block:"start"})`);
    await delay(150); await screenshot("mobile-summary-dark");
    await cdp.send("Page.navigate", { url: `${origin}/projects/${missingProjectId}/deviation` });
    await until(() => cdp.eval('document.body.innerText.includes("بدون جدول زمني") && document.body.innerText.includes("بند بلا جدول")'));
    assert(await cdp.eval('document.body.innerText.includes("لا يمكن تقييم الانحراف")'));
    await screenshot("no-schedule");
    assert.deepEqual(cdp.errors, []);
  } finally {
    cdp?.ws.close(); browser?.kill("SIGTERM");
    if (browser && browser.exitCode == null) await once(browser, "exit");
    await vite.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}
