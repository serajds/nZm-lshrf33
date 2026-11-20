// Opt-in real-app browser test. Uses an isolated PostgreSQL cluster only.
// NODE_ENV=development PROJECT_TAB_SCROLL_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/project-tab-scroll.browser.test.mjs
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

test("project tabs preserve their viewport position on desktop and phone", {
  skip: process.env.PROJECT_TAB_SCROLL_BROWSER !== "1",
  timeout: 240_000,
}, async () => {
  const postgres = await isolatedPostgres();
  let server, pool, vite, browser, cdp, profile;

  try {
    const [{ default: app }, schema, { signToken }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
    ]);
    const { db, usersTable, projectsTable, reportsTable } = schema;
    pool = schema.pool;

    const [user] = await db.insert(usersTable).values({
      phone: "project-tab-scroll-fixture",
      passwordHash: "unused",
      fullName: "Project tab scroll fixture",
      role: "admin",
    }).returning();
    const [project] = await db.insert(projectsTable).values({
      name: "اختبار تبويبات المشروع",
      location: "isolated",
      contractor: "fixture",
      ownerEntity: "fixture",
      supervisorEntity: "fixture",
      startDate: "2026-01-01",
      expectedEndDate: "2029-12-31",
    }).returning();
    await db.insert(reportsTable).values(Array.from({ length: 32 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      return {
        projectId: project.id,
        reportNumber: index + 1,
        type: "weekly",
        reportDate: date,
        periodStart: date,
        periodEnd: date,
        workDescription: `وصف تقرير الاختبار ${index + 1}`,
        progressPercentage: index + 1,
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
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        proxy: { "/api": { target: `http://127.0.0.1:${server.address().port}`, changeOrigin: true } },
      },
    });
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    await vite.listen();

    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const debugPort = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    profile = await mkdtemp(join(tmpdir(), "project-tab-scroll-"));
    browser = spawn("/repl/tools/bin/chromium", [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore" });
    await until(() => fetch(`http://127.0.0.1:${debugPort}/json/version`).then(response => response.ok).catch(() => false));
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" }).then(response => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await once(cdp.ws, "open");
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const token = signToken({ userId: user.id, phone: user.phone, role: user.role });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem("auth_token", ${JSON.stringify(token)}); localStorage.setItem("pwa-install-dismissed-at", String(Date.now()));`,
    });

    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const assertTabPositionAfterClick = async ({ width, height, mobile, targetTab, horizontalScroll }) => {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile,
      });
      await cdp.send("Page.navigate", { url: `${origin}/projects/${project.id}/activities` });
      await until(() => cdp.eval(
        `!!document.querySelector('[data-project-page-scroll] nav[aria-label="أقسام المشروع"] a[href$="/activities"]')`,
      ));
      await delay(150);

      const before = await cdp.eval(`(() => {
        const root = document.querySelector("[data-project-page-scroll]");
        const nav = root.querySelector('nav[aria-label="أقسام المشروع"]');
        const navRect = nav.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        root.scrollTop = Math.max(0, root.scrollTop + navRect.top - rootRect.top - 120);
        nav.scrollLeft = ${horizontalScroll};
        const afterNavRect = nav.getBoundingClientRect();
        return {
          navTop: afterNavRect.top - root.getBoundingClientRect().top,
          navScrollLeft: nav.scrollLeft,
          scrollTop: root.scrollTop,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
        };
      })()`);
      const linkSelector = `a[href$="/${targetTab}"]`;
      await cdp.eval(`document.querySelector('[data-project-page-scroll] nav[aria-label="أقسام المشروع"] ${linkSelector}').click()`);
      await until(() => cdp.eval(
        `!!document.querySelector('[data-project-page-scroll] nav[aria-label="أقسام المشروع"] a[aria-current="page"][href$="/${targetTab}"]')`,
      ));
      await until(async () => {
        const state = await cdp.eval(`(() => {
          const root = document.querySelector("[data-project-page-scroll]");
          const nav = root.querySelector('nav[aria-label="أقسام المشروع"]');
          return nav.getBoundingClientRect().top - root.getBoundingClientRect().top;
        })()`);
        return Math.abs(state - before.navTop) <= 3;
      });
      await delay(100);

      const after = await cdp.eval(`(() => {
        const root = document.querySelector("[data-project-page-scroll]");
        const nav = root.querySelector('nav[aria-label="أقسام المشروع"]');
        return {
          navTop: nav.getBoundingClientRect().top - root.getBoundingClientRect().top,
          navScrollLeft: nav.scrollLeft,
          scrollTop: root.scrollTop,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          reportRows: document.querySelectorAll("tbody tr").length,
          url: location.pathname,
          position: getComputedStyle(nav).position,
        };
      })()`);

      assert.ok(Math.abs(after.navTop - before.navTop) <= 3,
        `${width}px viewport: tab bar moved vertically ${before.navTop} -> ${after.navTop}; scrollTop ${before.scrollTop} -> ${after.scrollTop}; content ${after.scrollHeight}/${after.clientHeight}; rows ${after.reportRows}; ${after.url}`);
      assert.ok(Math.abs(after.navScrollLeft - before.navScrollLeft) <= 3,
        `${width}px viewport: horizontal tab position changed ${before.navScrollLeft} -> ${after.navScrollLeft}`);
      assert.notEqual(after.position, "sticky", "the tab bar remains in normal page flow");
      assert.ok(after.scrollTop > 0, "the page stays at the tab bar position instead of returning to the top");
    };

    await assertTabPositionAfterClick({
      width: 1440, height: 1000, mobile: false, targetTab: "reports", horizontalScroll: 0,
    });
    await assertTabPositionAfterClick({
      width: 390, height: 844, mobile: true, targetTab: "reports", horizontalScroll: -80,
    });

    assert.deepEqual(cdp.errors, []);
  } finally {
    cdp?.ws.close();
    browser?.kill("SIGTERM");
    if (browser && browser.exitCode == null) await once(browser, "exit");
    await vite?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await pool?.end();
    await postgres.stop();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});
