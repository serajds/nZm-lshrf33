import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "../artifacts/construction-supervision/node_modules/vite/dist/node/index.js";

test("report downloads an actual PDF without opening print", { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "report-pdf-"));
  const vite = await createServer({
    root: new URL("../artifacts/construction-supervision", import.meta.url).pathname,
    configFile: false,
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [{
      name: "pdf-test-page",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end("<!doctype html><html><body>PDF test</body></html>");
        });
      },
    }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await vite.listen();
  const browser = spawn("/repl/tools/bin/chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${dir}`, "about:blank",
  ], { stdio: "ignore" });
  let socket;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try { port = Number((await readFile(join(dir, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await delay(100); }
    }
    assert.ok(port);
    const target = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:${vite.httpServer.address().port}`, { method: "PUT" }).then(r => r.json());
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", e => {
      const message = JSON.parse(e.data);
      if (pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    const send = (method, params) => new Promise(resolve => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    await delay(1000);
    const result = await send("Runtime.evaluate", {
      expression: `(async () => {
        window.print = () => { throw new Error("print must not be called"); };
        const { downloadReportPdf } = await import("/src/lib/report-pdf.ts");
        await downloadReportPdf({
          projectName: "مشروع اختبار", reportType: "weekly", reportId: 12,
          reportDate: "2026-09-13", periodStart: "2026-09-07", periodEnd: "2026-09-13",
          progressPercentage: 45, workDescription: "أعمال التنفيذ والمتابعة\\n".repeat(80),
          activities: [{ name: "أعمال الخرسانة", plannedProgress: 50, actualProgress: 45, status: "in_progress" }]
        });
        return "done";
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result));
    assert.equal(result.result?.result?.value, "done");
    for (let i = 0; i < 100 && !(await readdir(dir)).includes("report-12.pdf"); i++) await delay(100);
    const pdf = await readFile(join(dir, "report-12.pdf"));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 10000);
  } finally {
    socket?.close();
    browser.kill("SIGTERM");
    await vite.close();
    await delay(500);
    await rm(dir, { recursive: true, force: true });
  }
});