// Opt-in: real app, private PostgreSQL fixtures, no user/project data touched.
// NODE_ENV=development REPORT_EDIT_SCROLL_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/report-edit-scroll.browser.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { Cdp, until } from "./helpers/deviation-browser.mjs";

test("editing a report near the end of the list preserves scroll and focus", {
  skip: process.env.REPORT_EDIT_SCROLL_BROWSER !== "1", timeout: 240_000,
}, async () => {
  const postgres = await isolatedPostgres();
  let server, pool, vite, browser, cdp, profile;
  try {
    const [{ default: app }, schema, { signToken }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"), import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
    ]);
    const { db, usersTable, projectsTable, reportsTable } = schema;
    pool = schema.pool;
    const [user] = await db.insert(usersTable).values({
      phone: "report-scroll-fixture", passwordHash: "unused", fullName: "Report scroll fixture", role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "اختبار ثبات التقارير", location: "isolated", contractor: "fixture",
      ownerEntity: "fixture", supervisorEntity: "fixture",
      startDate: "2026-01-01", expectedEndDate: "2029-12-31",
    }).returning();
    await db.insert(reportsTable).values(Array.from({ length: 32 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
      return {
        projectId: project.id,
        reportNumber: i + 1,
        type: "weekly",
        reportDate: date,
        periodStart: date,
        periodEnd: date,
        workDescription: `وصف تقرير الاختبار ${i + 1}`,
        progressPercentage: i + 1,
        imageUrls: [],
        activitiesSnapshot: [],
      };
    }));

    server = createServer((req, res) => app(req, res)).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { createServer: createVite } = await import("../artifacts/construction-supervision/node_modules/vite/dist/node/index.js");
    const previousPort = process.env.PORT;
    process.env.PORT = "5000";
    vite = await createVite({
      root: resolve("artifacts/construction-supervision"),
      configFile: resolve("artifacts/construction-supervision/vite.config.ts"),
      server: { host: "127.0.0.1", port: 0, strictPort: false,
        proxy: { "/api": { target: `http://127.0.0.1:${server.address().port}`, changeOrigin: true } } },
    });
    if (previousPort === undefined) delete process.env.PORT; else process.env.PORT = previousPort;
    await vite.listen();
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const debugPort = probe.address().port;
    await new Promise(r => probe.close(r));
    profile = await mkdtemp(join(tmpdir(), "report-edit-scroll-"));
    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(r => r.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
    cdp = new Cdp(target.webSocketDebuggerUrl); await once(cdp.ws, "open");
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const token = signToken({ userId: user.id, phone: user.phone, role: user.role });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      localStorage.setItem("auth_token", ${JSON.stringify(token)});
      localStorage.setItem("pwa-install-dismissed-at",String(Date.now()));
      window.focusLog=[];
      const originalFocus=HTMLElement.prototype.focus;
      HTMLElement.prototype.focus=function(...args){
        window.focusLog.push({tag:this.tagName,text:(this.textContent||"").trim().slice(0,65),args});
        return originalFocus.apply(this,args);
      };
      window.failNextSave=false;
      window.reportListRequests=0;
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,options={})=>{
        const method=String(options.method||input.method||"GET").toUpperCase();
        const requestUrl=input instanceof Request ? input.url : String(input);
        if(method==="GET" && new URL(requestUrl,location.href).pathname===${JSON.stringify(`/api/projects/${project.id}/reports`)}) {
          window.reportListRequests++;
        }
        if(method==="PATCH" && window.failNextSave){
          window.failNextSave=false;
          return Response.json({error:"fixture network failure"},{status:500});
        }
        return originalFetch(input,options);
      };
    ` });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${vite.httpServer.address().port}/projects/${project.id}/reports` });
    await until(() => cdp.eval('document.querySelectorAll("tbody tr").length === 32'));

    const row = ` [...document.querySelectorAll("tbody tr")].find(r=>[...r.querySelectorAll("td")].some(td=>td.textContent.trim()==="#1"))`;
    const getScrollState = () => cdp.eval(`(()=>{
      const r=${row}, scroller=window.reportScrollElement;
      const opener=window.editOpener;
      return {
        scrollTop:scroller?.scrollTop ?? window.scrollY,
        rowTop:r?.getBoundingClientRect().top,
        openerConnected:!!opener?.isConnected,
        openerFocused:document.activeElement===opener,
        activeText:(document.activeElement?.textContent||"").trim().slice(0,65),
        listStable:window.reportList===document.querySelector("tbody"),
      };
    })()`);
    const openBottomReport = async () => {
      await cdp.eval(`(()=>{
        const r=${row};
        const b=[...r.querySelectorAll("button")].find(b=>b.textContent.includes("تعديل"));
        if(!b)throw Error("report edit button missing");
        let node=r;
        while(node && node!==document.body){
          const style=getComputedStyle(node);
          if(/auto|scroll/.test(style.overflowY) && node.scrollHeight>node.clientHeight+10){
            window.reportScrollElement=node; break;
          }
          node=node.parentElement;
        }
        if(!window.reportScrollElement)window.reportScrollElement=document.scrollingElement;
        window.editOpener=b;
        window.reportList=document.querySelector("tbody");
        b.scrollIntoView({block:"center",inline:"nearest"});
      })()`);
      await delay(250);
      const box = await cdp.eval(`(()=>{
        const r=window.editOpener.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...box });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...box });
      await until(() => cdp.eval('!!document.querySelector(\'[role="dialog"] form\')'));
      await delay(200);
      const before = await getScrollState();
      assert.ok(before.rowTop > 65 && before.rowTop < 1000, "the edited bottom report remains visible");
      return before;
    };
    const click = async expression => {
      await cdp.eval(`(${expression}).scrollIntoView({block:"center",inline:"nearest"})`);
      await delay(100);
      const box = await cdp.eval(`(()=>{
        const e=${expression}; const r=e.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...box });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...box });
    };
    const assertReturnedToReport = async (before, action) => {
      await delay(350);
      const after = await getScrollState();
      assert.ok(Math.abs(after.scrollTop - before.scrollTop) <= 3,
        `${action}: scroll position ${before.scrollTop} -> ${after.scrollTop}`);
      assert.ok(after.rowTop > 65 && after.rowTop < 1000, `${action}: report remains visible`);
      assert.equal(after.listStable, true, `${action}: report list stays mounted`);
      assert.equal(after.openerConnected, true, `${action}: edit control remains connected`);
      assert.equal(after.openerFocused, true, `${action}: focus returns to the edited report`);
    };
    const setDescription = value => cdp.eval(`(()=>{
      const t=document.querySelector('[role="dialog"] textarea[name="workDescription"]');
      if(!t)throw Error("work description field missing");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t,${JSON.stringify(value)});
      t.dispatchEvent(new Event("input",{bubbles:true}));
    })()`);
    const apiReport = async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}/reports/1`,
        { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      return response.json();
    };

    // Cancel does not save changes and must return focus to this row's editor.
    let before = await openBottomReport();
    await setDescription("إلغاء تجريبي دون حفظ");
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes("إلغاء والتراجع"))`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')'));
    await assertReturnedToReport(before, "cancel");
    assert.equal((await apiReport()).workDescription, "وصف تقرير الاختبار 1");

    // A failed save leaves the dialog editable; cancelling afterward restores
    // the same scroll position and contextual focus.
    before = await openBottomReport();
    await setDescription("تغيير يجب أن يفشل");
    await cdp.eval("window.failNextSave=true");
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('document.body.innerText.includes("فشل الحفظ")'));
    assert.equal(await cdp.eval('!!document.querySelector(\'[role="dialog"]\')'), true);
    assert.equal((await apiReport()).workDescription, "وصف تقرير الاختبار 1");
    const afterFailure = await getScrollState();
    assert.ok(Math.abs(afterFailure.scrollTop - before.scrollTop) <= 3, "failed save leaves list scroll unchanged");
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.includes("إلغاء والتراجع"))`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')'));
    await assertReturnedToReport(before, "cancel after failed save");

    // Successful update still refreshes the canonical report data.
    before = await openBottomReport();
    await setDescription("وصف التقرير بعد التحديث");
    const previousListRequests = await cdp.eval("window.reportListRequests");
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')'));
    await until(async () => (await apiReport()).workDescription === "وصف التقرير بعد التحديث");
    await until(() => cdp.eval(`window.reportListRequests>${previousListRequests}`));
    await assertReturnedToReport(before, "successful save");
    assert.deepEqual(cdp.errors, []);
  } finally {
    cdp?.ws.close(); browser?.kill("SIGTERM");
    if (browser && browser.exitCode == null) await once(browser, "exit");
    await vite?.close();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    await pool?.end(); await postgres.stop();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});
