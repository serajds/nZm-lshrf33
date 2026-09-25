import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, pool, projectsTable, activityGroupsTable, activitiesTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { signToken } from "../src/lib/auth";
import { reconcileGroupToSideProject } from "../src/lib/external-sources";

if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This visual check requires the development database");
}

const appUrl = process.env.LAYOUT_APP_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:22349");

async function pause(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function debugPort(profile: string, browser: ChildProcess): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (browser.exitCode !== null) throw new Error(`Chromium exited with ${browser.exitCode}`);
    try {
      return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]);
    } catch {
      await pause(100);
    }
  }
  throw new Error("Chromium remote debugging did not start");
}

async function connectDebugger(port: number) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const target = targets.find(item => item.type === "page");
  assert.ok(target, "Chromium did not open a page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Cannot connect to Chromium")), { once: true });
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>();
  socket.addEventListener("message", event => {
    const response = JSON.parse(String(event.data));
    if (response.id == null) return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.error) request.reject(new Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async <T>(expression: string): Promise<T> => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value as T;
  };
  return { socket, send, evaluate };
}

async function main() {
  const projectIds: number[] = [];
  let testUserId: number | undefined;
  let browser: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  const profile = await mkdtemp(join(tmpdir(), "side-project-viewport-"));
  const output = join(tmpdir(), "side-project-responsive-check");
  await mkdir(output, { recursive: true });
  try {
    const base = { location: "responsive-test", ownerEntity: "test", supervisorEntity: "test", contractor: "test", noSchedule: true };
    const suffix = `layout-${Date.now()}`;
    const [target, firstSource, secondSource] = await db.insert(projectsTable).values([
      { ...base, name: `مشروع رئيسي لاختبار عرض الهاتف ${suffix}` },
      { ...base, name: `مشروع جانبي أول ${suffix}` },
      { ...base, name: `مشروع جانبي ثانٍ ${suffix}` },
    ]).returning();
    projectIds.push(target.id, firstSource.id, secondSource.id);
    const [first, second, ordinary, sourceOne, sourceTwo] = await db.insert(activityGroupsTable).values([
      { projectId: target.id, name: "مجموعة الأعمال المعمارية طويلة الاسم على شاشة الهاتف" },
      { projectId: target.id, name: "مجموعة أعمال الموقع والخدمات والبنية التحتية" },
      { projectId: target.id, name: "مجموعة عادية دون أي ارتباط" },
      { projectId: firstSource.id, name: "أعمال الحفر" },
      { projectId: secondSource.id, name: "أعمال الأساسات" },
    ]).returning();
    await db.insert(activitiesTable).values([
      { projectId: firstSource.id, groupId: sourceOne.id, name: "بند أعمال المصدر الأول", actualProgress: 45, plannedStartDate: "2026-04-01", plannedEndDate: "2026-12-01" },
      { projectId: secondSource.id, groupId: sourceTwo.id, name: "بند أعمال المصدر الثاني", actualProgress: 25, plannedStartDate: "2026-05-01", plannedEndDate: "2027-01-01" },
    ]);
    assert.equal((await reconcileGroupToSideProject(first.id, firstSource.id)).created, 1);
    assert.equal((await reconcileGroupToSideProject(second.id, secondSource.id)).created, 1);
    assert.ok(ordinary.id);
    const [user] = await db.insert(usersTable).values({
      phone: `${suffix}-admin`, passwordHash: "visual-test", fullName: "Visual Test", role: "admin",
    }).returning();
    testUserId = user.id;
    const token = signToken({ userId: user.id, phone: user.phone, role: "admin" });

    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--disable-background-networking", "--remote-allow-origins=*",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: "ignore" });
    const port = await debugPort(profile, browser);
    const debuggerClient = await connectDebugger(port);
    socket = debuggerClient.socket;
    const { send, evaluate } = debuggerClient;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url: appUrl });
    await pause(1200);
    await evaluate(`localStorage.setItem("auth_token", ${JSON.stringify(token)}); location.assign(${JSON.stringify(`${appUrl}/projects/${target.id}/activities`)});`);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await evaluate<boolean>('document.body?.innerText?.includes("فهرس المجموعات") ?? false')) break;
      await pause(250);
    }
    if (!await evaluate<boolean>('document.body?.innerText?.includes("فهرس المجموعات") ?? false')) {
      const diagnostic = await evaluate<{ href: string; body: string; hasToken: boolean }>(`({
        href: location.href, body: document.body?.innerText?.slice(0, 400) ?? "",
        hasToken: !!localStorage.getItem("auth_token")
      })`);
      throw new Error(`Activities page did not load: ${JSON.stringify(diagnostic)}`);
    }
    const widths = [320, 360, 390, 430, 768];
    for (const width of widths) {
      await send("Emulation.setDeviceMetricsOverride", {
        width, height: 800, deviceScaleFactor: 1, mobile: true,
      });
      await pause(400);
      const check = async (state: string) => {
        const metrics = await evaluate<{ viewport: number; document: number; body: number; dialogs: number }>(`({
          viewport: document.documentElement.clientWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          dialogs: document.querySelectorAll('[role="dialog"]').length
        })`);
        const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await writeFile(join(output, `${width}-${state}.png`), Buffer.from(screenshot.data, "base64"));
        console.log(`${width}px ${state}: viewport=${metrics.viewport}, document=${metrics.document}, body=${metrics.body}`);
        assert.ok(metrics.document <= metrics.viewport + 2, `${width}px ${state} has page-level horizontal overflow`);
      };
      await evaluate('document.querySelector(\'[aria-label="فهرس مجموعات بنود الأعمال"]\')?.scrollIntoView({ block: "center" })');
      await pause(100);
      await check("groups");
      const openMenu = async (name: string) => {
        const trigger = await evaluate<{ x: number; y: number } | null>(`(() => {
          const button = [...document.querySelectorAll("button")].find(element =>
            element.getAttribute("aria-label") === ${JSON.stringify(`إعدادات مجموعة ${name}`)});
          if (!button) return null;
          button.scrollIntoView({ block: "center" });
          const rect = button.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        assert.ok(trigger, `Settings trigger missing for ${name}`);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: trigger.x, y: trigger.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: trigger.x, y: trigger.y, button: "left", clickCount: 1 });
        await pause(160);
        assert.equal(await evaluate<number>('document.querySelectorAll(\'[role="menu"]\').length'), 1, `Settings menu did not open for ${name}`);
      };
      const choose = async (text: string) => {
        assert.ok(await evaluate<boolean>(`(() => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent?.includes(${JSON.stringify(text)}));
          if (!item) return false;
          item.click();
          return true;
        })()`), `Missing menu action: ${text}`);
        await pause(350);
        assert.equal(await evaluate<number>('document.querySelectorAll(\'[role="menu"]\').length'), 0, `Menu stayed open after ${text}`);
      };
      const closeDialog = async () => {
        assert.ok(await evaluate<boolean>('(() => { const button = [...document.querySelectorAll(\'[role="dialog"] button, [role="alertdialog"] button\')].find(b => b.textContent?.trim() === "إلغاء"); button?.click(); return !!button; })()'), "Cancel button missing");
        await pause(400);
        assert.equal(await evaluate<number>('document.querySelectorAll(\'[role="dialog"],[role="alertdialog"]\').length'), 0, "Dialog did not close");
      };
      const names = [
        { name: "مجموعة عادية دون أي ارتباط", linked: false, count: 0, key: "ordinary" },
        { name: "مجموعة الأعمال المعمارية طويلة الاسم على شاشة الهاتف", linked: true, count: 1, key: "first" },
        { name: "مجموعة أعمال الموقع والخدمات والبنية التحتية", linked: true, count: 1, key: "second" },
      ];
      for (const { name, linked, count, key } of names) {
        await openMenu(name);
        await check(`menu-${key}`);
        if (linked) {
          assert.ok(await evaluate<boolean>('document.querySelector(\'[role="menu"]\')?.textContent?.includes("مزامنة الآن") ?? false'), "Sync missing from linked menu");
          assert.ok(await evaluate<boolean>('document.querySelector(\'[role="menu"]\')?.textContent?.includes("فصل المشروع الجانبي") ?? false'), "Disconnect missing from linked menu");
        }
        await choose(linked ? "تغيير رمز الربط" : "ربط برمز مشروع");
        assert.ok(await evaluate<boolean>('!!document.querySelector(\'[role="dialog"] input\')'), "Link code input missing");
        assert.equal(await evaluate<number>('document.querySelectorAll(\'[role="dialog"] [role="option"]\').length'), 0, "Project suggestions must not appear");
        await check(`link-dialog-${key}`);
        await closeDialog();
        if (linked) {
          await openMenu(name);
          await choose("مزامنة الآن");
          for (let attempt = 0; attempt < 30; attempt++) {
            if (await evaluate<boolean>('document.body?.innerText?.includes("اكتملت المزامنة") ?? false')) break;
            await pause(100);
          }
          assert.ok(await evaluate<boolean>('document.body?.innerText?.includes("اكتملت المزامنة") ?? false'), "Sync action did not complete");
          await openMenu(name);
          await choose("فصل المشروع الجانبي");
          assert.ok(await evaluate<boolean>('document.querySelector(\'[role="alertdialog"]\')?.textContent?.includes("فصل المشروع الجانبي") ?? false'), "Disconnect confirmation missing");
          await closeDialog();
        }
        await openMenu(name);
        await choose("تعديل المجموعة");
        assert.ok(await evaluate<boolean>('!!document.querySelector(\'[role="dialog"]\')'), "Edit dialog did not open");
        await check(`edit-dialog-${key}`);
        await closeDialog();
        await openMenu(name);
        await choose("حذف المجموعة");
        assert.ok(await evaluate<boolean>('!!document.querySelector(\'[role="alertdialog"]\')'), "Delete dialog did not open");
        assert.equal(await evaluate<boolean>('!![...document.querySelectorAll(\'[role="alertdialog"] button\')].find(b => b.textContent?.includes("حذف المجموعة الفارغة"))'), count === 0, "Delete rule broken");
        if (count > 0) assert.ok(await evaluate<boolean>('document.querySelector(\'[role="alertdialog"]\')?.textContent?.includes("لا يمكن حذف") ?? false'), "Occupied-group reason missing");
        await check(`delete-dialog-${key}`);
        await closeDialog();
        await openMenu(name);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 5, y: 150, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 5, y: 150, button: "left", clickCount: 1 });
        await pause(200);
        assert.equal(await evaluate<number>('document.querySelectorAll(\'[role="menu"]\').length'), 0, "Outside click did not close menu");
      }
      assert.ok(await evaluate<boolean>('(() => { const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "جانت"); button?.click(); return !!button; })()'), "Gantt switch missing");
      await pause(180);
      assert.ok(await evaluate<boolean>('!!document.querySelector(\'[aria-label="المخطط الزمني قابل للتمرير أفقياً"]\')'), "Gantt region not rendered");
      await evaluate('document.querySelector(\'[aria-label="المخطط الزمني قابل للتمرير أفقياً"]\')?.scrollIntoView({ block: "center" })');
      await pause(100);
      await check("gantt");
      assert.ok(await evaluate<boolean>('(() => { const button = document.querySelector(\'button[title="عرض القائمة"]\'); button?.click(); return !!button; })()'), "List switch missing");
    }
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    await pause(400);
    await evaluate('document.querySelector(\'[aria-label="فهرس مجموعات بنود الأعمال"]\')?.scrollIntoView({ block: "center" })');
    const desktopMetrics = await evaluate<{ viewport: number; document: number }>('({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth })');
    assert.ok(desktopMetrics.document <= desktopMetrics.viewport + 2, "Desktop group index has page-level overflow");
    const desktopScreenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(join(output, "1280-groups.png"), Buffer.from(desktopScreenshot.data, "base64"));
    const ordinaryTrigger = await evaluate<{ x: number; y: number }>(`(() => {
      const button = document.querySelector('button[aria-label="إعدادات مجموعة مجموعة عادية دون أي ارتباط"]');
      if (!button) throw Error("Empty group settings missing before deletion");
      button.scrollIntoView({ block: "center" });
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: ordinaryTrigger.x, y: ordinaryTrigger.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: ordinaryTrigger.x, y: ordinaryTrigger.y, button: "left", clickCount: 1 });
    await pause(200);
    await evaluate('[...document.querySelectorAll(\'[role="menuitem"]\')].find(item => item.textContent?.includes("حذف المجموعة"))?.click()');
    await pause(300);
    assert.ok(await evaluate<boolean>('!!document.querySelector(\'[role="alertdialog"]\')'), "Empty-group delete confirmation missing");
    await evaluate('[...document.querySelectorAll(\'[role="alertdialog"] button\')].find(button => button.textContent?.includes("حذف المجموعة الفارغة"))?.click()');
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!await evaluate<boolean>('!!document.querySelector(\'button[aria-label="إعدادات مجموعة مجموعة عادية دون أي ارتباط"]\')')) break;
      await pause(100);
    }
    assert.equal(await evaluate<boolean>('!!document.querySelector(\'button[aria-label="إعدادات مجموعة مجموعة عادية دون أي ارتباط"]\')'), false, "Empty group was not deleted");
    console.log(`Mobile screenshots saved in ${output}`);
  } finally {
    socket?.close();
    if (browser && browser.exitCode === null) {
      browser.kill("SIGTERM");
      await Promise.race([
        new Promise<void>(resolve => browser!.once("exit", () => resolve())),
        pause(3000),
      ]);
    }
    try {
      if (projectIds.length) {
        await db.delete(activitiesTable).where(inArray(activitiesTable.projectId, projectIds));
        await db.delete(activityGroupsTable).where(inArray(activityGroupsTable.projectId, projectIds));
        await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
      }
      if (testUserId != null) await db.delete(usersTable).where(eq(usersTable.id, testUserId));
    } finally {
      await pool.end();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});