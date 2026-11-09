// Opt-in: real app, private PostgreSQL fixtures, no user/project data touched.
// NODE_ENV=development ACTIVITY_SCROLL_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/activity-progress-scroll.browser.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
import { Cdp, until } from "./helpers/deviation-browser.mjs";

test("activity save keeps the real app's scroll and context", {
  skip: process.env.ACTIVITY_SCROLL_BROWSER !== "1", timeout: 240_000,
}, async () => {
  const postgres = await isolatedPostgres();
  let server, pool, vite, browser, cdp, profile;
  try {
    const [{ default: app }, schema, { signToken }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"), import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
    ]);
    const { db, usersTable, projectsTable, activitiesTable, activityGroupsTable } = schema;
    pool = schema.pool;
    const [user] = await db.insert(usersTable).values({
      phone: "scroll-fixture", passwordHash: "unused", fullName: "Scroll fixture", role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "اختبار حفظ الموضع", location: "isolated", contractor: "fixture",
      ownerEntity: "fixture", supervisorEntity: "fixture",
      startDate: "2026-01-01", expectedEndDate: "2029-12-31",
    }).returning();
    const [group, collapsedGroup] = await db.insert(activityGroupsTable).values([
      { projectId: project.id, name: "مجموعة الاختبار", color: "#008899" },
      { projectId: project.id, name: "مجموعة تبقى مطوية", color: "#008899", sortOrder: 1 },
    ]).returning();
    await db.insert(activitiesTable).values(Array.from({ length: 90 }, (_, i) => ({
      projectId: project.id, groupId: group.id, name: `بند اختبار ${String(i + 1).padStart(3, "0")}`,
      plannedStartDate: "2026-01-01", plannedEndDate: "2029-12-31",
      status: "in_progress", actualProgress: 40, weight: 1, sortOrder: i,
    })));
    await db.insert(activitiesTable).values({
      projectId: project.id, groupId: collapsedGroup.id, name: "بند داخل مجموعة مطوية",
      plannedStartDate: "2026-01-01", plannedEndDate: "2029-12-31",
      status: "in_progress", actualProgress: 40, weight: 1, sortOrder: 91,
    });
    const requests = [];
    server = createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      app(req, res);
    }).listen(0, "127.0.0.1");
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
    profile = await mkdtemp(join(tmpdir(), "activity-scroll-"));
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
      window.focusLog=[]; const originalFocus=HTMLElement.prototype.focus;
      HTMLElement.prototype.focus=function(...args){
        window.focusLog.push({tag:this.tagName,text:(this.textContent||"").slice(0,65),args,stack:new Error().stack?.split("\\n").slice(1,5)});
        return originalFocus.apply(this,args);
      };
      window.appLoads=Number(sessionStorage.getItem("scroll-test-loads")||"0")+1;
      sessionStorage.setItem("scroll-test-loads",String(window.appLoads));
      window.saveStarts=0;
      const originalFetch=window.fetch.bind(window);
      window.fetch=async(input,options={})=>{
        const method=String(options.method||input.method||"GET").toUpperCase();
        if(method==="PATCH"){
          window.saveStarts++;
          if(window.failNextSave){window.failNextSave=false;return Response.json({error:"fixture network failure"},{status:500});}
          if(window.holdSave)await new Promise(resolve=>window.releaseSave=resolve);
        }
        return originalFetch(input,options);
      };
    ` });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${vite.httpServer.address().port}/projects/${project.id}/activities` });
    await until(() => cdp.eval('document.querySelectorAll("tbody tr").length >= 90'));
    const row = `[...document.querySelectorAll('[data-activity-id="80"]')].find(r=>r.getClientRects().length)`;
    const scrollState = () => cdp.eval(`(()=>{
      const row=${row}, main=document.querySelector("main .overflow-auto"), horizontal=document.querySelector("table")?.parentElement;
      return {top:main?.scrollTop,left:horizontal?.scrollLeft,rowTop:row?.getBoundingClientRect().top,
        rows:document.querySelectorAll("tbody tr").length,loads:window.appLoads,
        rowStable:row===window.savedRow,listStable:main===window.savedList};
    })()`);
    const click = async expression => {
      await cdp.eval(`(${expression}).scrollIntoView({block:"center",inline:"nearest"})`);
      await delay(250);
      const box = await cdp.eval(`(()=>{const e=${expression}; if(!e)throw Error("missing control");const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...box });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...box });
    };
    const snapshots = [];
    const setInput = (selector, value) => cdp.eval(`(()=>{
      const i=document.querySelector(${JSON.stringify(selector)});
      if(!i)throw Error("missing input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(i,${JSON.stringify(String(value))});
      i.dispatchEvent(new Event("input",{bubbles:true}));
    })()`);
    const get = async suffix => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project.id}${suffix}`,
        { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const verifyProgress = async expected => {
      await until(async () => (await get("/activities")).find(a => a.id === 80).actualProgress === expected);
      const summary = await get("/summary");
      const analysis = await get("/deviation?curve=linear");
      assert.equal(summary.overallProgress, Math.round(analysis.actualProgress * 10) / 10, "summary stays live");
      assert.equal(analysis.actualProgress, (90 * 40 + expected) / 91);
    };
    const remember = async () => {
      await cdp.eval(`window.savedRow=${row};window.savedList=document.querySelector("main .overflow-auto");void 0`);
      return scrollState();
    };
    const stable = async (before, step, rowExists = true) => {
      const after = await scrollState();
      snapshots.push({ step, before: before.top, after: after.top, leftBefore: before.left, leftAfter: after.left });
      assert.ok(Math.abs(after.top - before.top) <= (rowExists ? 3 : 200), `${step}: vertical position ${before.top} -> ${after.top}`);
      assert.ok(Math.abs(after.left - before.left) <= 1, `${step}: horizontal position preserved`);
      if (rowExists) {
        assert.equal(after.rowStable, true, `${step}: same row DOM, not a remount`);
        assert.ok(after.rowTop > 65 && after.rowTop < 1000, `${step}: same item visible`);
      }
      assert.equal(after.listStable, true, `${step}: layout stays mounted`);
      assert.equal(after.loads, 1, `${step}: document not reloaded`);
      assert.equal(await cdp.eval('document.querySelector(\'input[placeholder*="ابحث"]\').value'), "بند", "search is preserved");
      assert.equal(await cdp.eval('!![...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("بند داخل مجموعة مطوية"))'), false, "group stays collapsed");
    };
    // Collapse another group and keep a nonempty search filter throughout saving.
    await click(`[...document.querySelectorAll("tbody tr")].find(r=>r.textContent.includes("مجموعة تبقى مطوية")).querySelector("td")`);
    await setInput('input[placeholder*="ابحث"]', "بند");
    await cdp.eval(`${row}.scrollIntoView({block:"center"})`); await delay(400);
    // Prepare the action column before recording horizontal position.
    await cdp.eval(`${row}.querySelector('button[title="رفع الإنجاز 5%"]').scrollIntoView({block:"center",inline:"nearest"})`);
    let before = await remember();
    for (const [title, expected] of [["رفع الإنجاز 5%", 45], ["تخفيض الإنجاز 5%", 40]]) {
      await click(`${row}.querySelector('button[title="${title}"]')`);
      await until(() => cdp.eval(`${row}.querySelector('button[title="${title}"]').disabled===false`));
      await verifyProgress(expected);
      await stable(before, title);
    }
    await click(`${row}.querySelector('button[aria-label^="تحديد نسبة إنجاز"]')`);
    await until(() => cdp.eval('!!document.querySelector(\'[role="dialog"] input\')'));
    before = await remember();
    await setInput('[role="dialog"] input', 55);
    // A pending save stays local and disables duplicate submission.
    await cdp.eval("window.holdSave=true;window.startsBefore=window.saveStarts");
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval("typeof window.releaseSave==='function'"));
    assert.equal(await cdp.eval('document.querySelector(\'[role="dialog"] button[type="submit"]\').disabled'), true);
    await cdp.eval('document.querySelector(\'[role="dialog"] button[type="submit"]\').click()');
    assert.equal(await cdp.eval("window.saveStarts-window.startsBefore"), 1);
    await cdp.eval("window.holdSave=false;window.releaseSave()");
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(500);
    await verifyProgress(55); await stable(before, "direct progress");
    assert.equal(await cdp.eval('document.activeElement?.getAttribute("aria-label")'), "تحديد نسبة إنجاز بند اختبار 080");
    await click(`${row}.querySelector('button[aria-label="تعديل بند اختبار 080"]')`);
    await until(() => cdp.eval('!!document.querySelector(\'[role="dialog"] form\')'));
    before = await remember();
    const progressInput = await cdp.eval(`document.querySelector('[role="dialog"] form input[name="actualProgress"]')?.id`);
    assert.ok(progressInput, "edit form has a real progress input");
    await setInput('[role="dialog"] form input[name="actualProgress"]', 65);
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(500);
    await verifyProgress(65); await stable(before, "edit progress");
    assert.equal(await cdp.eval('document.activeElement?.getAttribute("aria-label")'), "تعديل بند اختبار 080");
    // Edit errors preserve the unsaved form and the visible row.
    await click(`${row}.querySelector('button[aria-label="تعديل بند اختبار 080"]')`);
    before = await remember();
    await setInput('[role="dialog"] form input[name="actualProgress"]', 70);
    await cdp.eval("window.failNextSave=true");
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('document.body.innerText.includes("فشل الحفظ")'));
    assert.equal(await cdp.eval('document.querySelector(\'[role="dialog"] input[name="actualProgress"]\').value'), "70");
    await verifyProgress(65); await stable(before, "failed edit save");
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==="إلغاء والتراجع")`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(300);
    await stable(before, "cancel edit");
    // Increment errors likewise leave the canonical progress intact.
    await cdp.eval("window.failNextSave=true");
    before = await remember();
    await click(`${row}.querySelector('button[title="رفع الإنجاز 5%"]')`);
    await until(() => cdp.eval(`${row}.querySelector('button[title="رفع الإنجاز 5%"]').disabled===false`));
    await verifyProgress(65); await stable(before, "failed quick save");
    // Failure keeps the dialog and old data, not a fake successful update.
    await click(`${row}.querySelector('button[aria-label^="تحديد نسبة إنجاز"]')`);
    await setInput('[role="dialog"] input', 70); before = await remember();
    await cdp.eval("window.failNextSave=true");
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('document.body.innerText.includes("فشل التحديث")'));
    assert.equal(await cdp.eval('!!document.querySelector(\'[role="dialog"]\')'), true);
    await verifyProgress(65); await stable(before, "failed direct save");
    await click(`[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==="إلغاء")`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(300);
    await stable(before, "cancel direct");
    // Responsive mobile uses the same save paths but different row DOM.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(500);
    await click(`${row}.querySelector('button[aria-label^="تحديد نسبة إنجاز"]')`);
    before = await remember();
    await setInput('[role="dialog"] input', 75);
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(350);
    await verifyProgress(75); await stable(before, "mobile direct");
    await click(`${row}.querySelector('button[aria-label="تعديل بند اختبار 080"]')`);
    before = await remember();
    await setInput('[role="dialog"] form input[name="actualProgress"]', 85);
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(350);
    await verifyProgress(85); await stable(before, "mobile edit");
    before = await remember();
    await click(`${row}.querySelector('button[title="رفع الإنجاز 5%"]')`);
    await until(() => cdp.eval(`${row}.querySelector('button[title="رفع الإنجاز 5%"]').disabled===false`));
    await verifyProgress(90); await stable(before, "mobile quick");
    assert.equal(await cdp.eval("document.documentElement.scrollWidth<=innerWidth+1"), true);
    await mkdir("generated-artifacts/activity-scroll", { recursive: true });
    const image = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    await writeFile("generated-artifacts/activity-scroll/mobile.jpg", Buffer.from(image.data, "base64"));
    // A completion can remove its own opener from a status-filtered list.
    await click(`document.querySelector('button[aria-label="تصفية الحالة: قيد التنفيذ"]')`);
    await click(`${row}.querySelector('button[aria-label^="تحديد نسبة إنجاز"]')`);
    before = await remember();
    await setInput('[role="dialog"] input', 100);
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(350);
    await verifyProgress(100); await stable(before, "filtered completed row disappears", false);
    assert.equal(await cdp.eval(`!!(${row})`), false);
    assert.equal(await cdp.eval('document.querySelector(\'button[aria-label="تصفية الحالة: قيد التنفيذ"]\').getAttribute("aria-pressed")'), "true");
    assert.equal(await cdp.eval('window.savedList.contains(document.activeElement)'), true, "focus uses the stable list fallback");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await delay(350);
    await click(`document.querySelector('button[aria-label="تصفية الحالة: قيد التنفيذ"]')`);
    // Toggle all statuses, bringing back the completed row, then use Edit
    // to move it out of the completed-status filter.
    await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes("كل الحالات")&&b.hasAttribute("aria-pressed"))`);
    await click(`document.querySelector('button[aria-label="تصفية الحالة: مكتمل"]')`);
    await click(`${row}.querySelector('button[aria-label="تعديل بند اختبار 080"]')`);
    await setInput('[role="dialog"] form input[name="actualProgress"]', 80);
    // Edit has an explicit status field; progress-only edits retain its current status.
    await click(`[...document.querySelectorAll('[role="dialog"] button[role="combobox"]')].find(b=>b.textContent.includes("مكتمل"))`);
    await click(`[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==="قيد التنفيذ")`);
    await click(`document.querySelector('[role="dialog"] button[type="submit"]')`);
    await until(() => cdp.eval('!document.querySelector(\'[role="dialog"]\')')); await delay(350);
    assert.equal(await cdp.eval(`!!(${row})`), false, "edit respects the existing status filter");
    assert.equal(await cdp.eval('document.querySelector(\'button[aria-label="تصفية الحالة: مكتمل"]\').getAttribute("aria-pressed")'), "true");
    await verifyProgress(80);
    await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes("كل الحالات")&&b.hasAttribute("aria-pressed"))`);
    await cdp.eval(`${row}.scrollIntoView({block:"center"})`); await delay(300);
    const desktopImage = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    await writeFile("generated-artifacts/activity-scroll/desktop.jpg", Buffer.from(desktopImage.data, "base64"));
    await writeFile("generated-artifacts/activity-scroll/verification.json", JSON.stringify({ snapshots, errors: cdp.errors }, null, 2));
    console.log(JSON.stringify({ snapshots, saves: requests.filter(r => r.method === "PATCH").length, errors: cdp.errors }));
    assert.equal(await cdp.eval("window.appLoads"), 1);
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
