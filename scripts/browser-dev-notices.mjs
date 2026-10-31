// Isolated browser verification: real development components, synthetic API
// responses, no credentials and no writes to the application's database.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.NOTICE_TEST_ORIGIN || "http://127.0.0.1:22349";
const output = "generated-artifacts/development-notices";
await mkdir(output, { recursive: true });
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
let seq = 0, fixture = false, claims = 0;
const pending = new Map(), failures = [], checks = [];
const user = { id: 900001, fullName: "عضو اختبار تجريبي", phone: "0000000000", role: "engineer" };
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
socket.addEventListener("message", async event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task?.reject(new Error(message.error.message));
    else task?.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    failures.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  }
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  const url = new URL(request.url);
  try {
    if (url.pathname.startsWith("/api/")) {
      let body = {};
      if (url.pathname === "/api/auth/me") body = user;
      if (url.pathname.endsWith("/my-activity-reminder/claim")) {
        claims++;
        await new Promise(resolve => setTimeout(resolve, 200));
        body = { show: true, fullName: user.fullName, lastUpdatedAt: "2026-10-30T10:00:00Z" };
      }
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(body)).toString("base64") });
    } else if (fixture && url.pathname === "/src/main.tsx") {
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
        body: Buffer.from("window.__isolatedFixture = true;").toString("base64") });
    } else {
      await send("Fetch.continueRequest", { requestId });
    }
  } catch (error) {
    if (!/Invalid InterceptionId|Invalid interceptionId/.test(error.message)) failures.push(error.message);
  }
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function snapshot(name) {
  const image = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`${output}/${name}.png`, Buffer.from(image.data, "base64"));
}
const openDialogs = `document.querySelectorAll('[role="dialog"][data-state="open"]').length`;
const dialogText = `document.querySelector('[role="dialog"][data-state="open"]')?.innerText || ''`;
const remaining = `parseFloat(document.querySelector('[role="dialog"][data-state="open"] .h-1 > div')?.style.width || '0')`;
const paused = `(${dialogText}).includes('متوقف مؤقتًا')`;

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try { localStorage.clear(); sessionStorage.clear(); } catch {}",
  });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: base });
  await waitFor(`location.pathname === '/login' && !document.getElementById('app-splash')`);
  checks.push("Normal guest startup reaches login and removes splash.");

  await evaluate(`window.dispatchEvent(new ErrorEvent('error', {
    message:'SYNTHETIC_METADATA_CHECK', filename:'${base}/__synthetic_source__.js', lineno:8, colno:2
  }))`);
  await waitFor(`document.querySelector('vite-error-overlay')?.shadowRoot?.textContent.includes('SYNTHETIC_METADATA_CHECK')`);
  assert.equal(await evaluate(`document.querySelector('vite-error-overlay').shadowRoot.textContent.includes('(unknown runtime error)')`), false);
  await snapshot("diagnostic-metadata");
  checks.push("Missing native Error metadata reaches the existing overlay with its real synthetic message.");
  await evaluate(`document.querySelector('vite-error-overlay').remove()`);
  await evaluate(`window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
    promise:Promise.resolve(), reason:'SYNTHETIC_STRING_CHECK'
  }))`);
  await waitFor(`document.querySelector('vite-error-overlay')?.shadowRoot?.textContent.includes('SYNTHETIC_STRING_CHECK')`);
  checks.push("String promise rejection reaches the overlay without an unknown-error replacement.");

  // Read Vite's transformed imports outside the browser interception. This
  // guarantees the fixture shares React and Query module instances with source.
  const imports = text => [...text.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(match => match[1]);
  const source = await (await fetch(`${base}/src/hooks/use-auth.tsx`)).text();
  const main = await (await fetch(`${base}/src/main.tsx`)).text();
  const paths = {
    react: imports(source).find(path => /\/react\.js[?]/.test(path)),
    query: imports(source).find(path => path.includes("tanstack_react-query")),
    dom: imports(main).find(path => path.includes("react-dom_client")),
    api: imports(source).find(path => path.includes("api-client-react")),
  };
  assert.ok(Object.values(paths).every(Boolean), "Vite dependency import paths available");
  fixture = true;
  await send("Page.navigate", { url: `${base}/__isolated_notices__` });
  await waitFor(`window.__isolatedFixture === true`);
  await evaluate(`(async () => {
    const paths = ${JSON.stringify(paths)};
    const [ReactModule, DomModule, Q, A, S, Auth, Notices, Quick, Reminder] = await Promise.all([
      import(paths.react), import(paths.dom), import(paths.query), import(paths.api),
      import('/src/lib/auth-session.ts'), import('/src/hooks/use-auth.tsx'),
      import('/src/components/automatic-notices.tsx'),
      import('/src/components/project-quick-view-dialog.tsx'),
      import('/src/components/project-activity-reminder.tsx'),
      import('/src/index.css')
    ]);
    const R = ReactModule.default || ReactModule;
    const D = DomModule.default || DomModule;
    localStorage.clear();
    const session = S.replaceAuthToken('synthetic-browser-token');
    localStorage.setItem('auth_user_cache', JSON.stringify({
      token:session.token, sessionId:session.sessionId, user:${JSON.stringify(user)}
    }));
    A.setAuthTokenGetter(S.getAuthToken);
    A.setAuthTokenSaver((next, old) => S.renewAuthToken(next, old));
    document.getElementById('app-splash')?.remove();
    const client = new Q.QueryClient({defaultOptions:{queries:{retry:false}}});
    const root = D.createRoot(document.getElementById('root'));
    const widgets = [{id:'fixture',label:'نسبة التنفيذ التجريبية',templateId:null,fieldId:null,value:'52%'}];
    function Harness({projectId,withReminder}) {
      const [page,setPage] = R.useState(0);
      window.fixtureNavigate = () => setPage(previous => previous+1);
      return R.createElement(R.Fragment,null,
        R.createElement(Quick.ProjectQuickViewDialog,{projectId,widgets,enabled:true}),
        withReminder ? R.createElement(Reminder.ProjectActivityReminder,{
          key:page,projectId,canViewActivities:true
        }) : null);
    }
    window.renderFixture = (projectId,withReminder=true) => root.render(
      R.createElement(Q.QueryClientProvider,{client},
        R.createElement(Auth.AuthProvider,null,
          R.createElement(Notices.AutomaticNoticeProvider,{key:projectId},
            R.createElement(Harness,{projectId,withReminder})))));
    window.unmountFixture = () => {root.unmount();client.clear();};
    window.renderFixture(900001);
  })()`);
  await waitFor(`(${dialogText}).includes('نظرة سريعة')`);
  await sleep(500);
  assert.equal(await evaluate(openDialogs), 1);
  assert.equal(claims, 1);
  await evaluate(`window.fixtureNavigate()`);
  await sleep(500);
  assert.equal(await evaluate(openDialogs), 1);
  assert.equal(claims, 1);
  checks.push("Both real dialogs ready: only quick-view opens; queued reminder survives sub-page remount without another claim.");

  const rect = await evaluate(`(() => {const r=document.querySelector('[role=dialog]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+20};})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
  await waitFor(paused);
  let first = await evaluate(remaining);
  await sleep(1200);
  assert.ok(Math.abs((await evaluate(remaining)) - first) < 0.05);
  await snapshot("quick-view-paused");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await waitFor(`!(${paused})`);
  first = await evaluate(remaining);
  await sleep(1200);
  assert.ok(first - (await evaluate(remaining)) > 8);
  checks.push("Real pointer hover pauses the countdown; leaving resumes it using elapsed time.");

  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await waitFor(paused);
  first = await evaluate(remaining);
  await sleep(1100);
  assert.ok(Math.abs((await evaluate(remaining)) - first) < 0.05);
  checks.push("Real keyboard Tab interaction pauses the countdown while focus stays in the dialog.");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await waitFor(`!(${paused})`);
  await evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(paused);
  first = await evaluate(remaining);
  await sleep(1100);
  assert.ok(Math.abs((await evaluate(remaining)) - first) < 0.05);
  await evaluate(`delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(`!(${paused})`);
  checks.push("Simulated hidden-tab visibility event pauses without spending the remaining time.");
  await waitFor(`(${dialogText}).includes('تذكير تحديث الجدول الزمني')`, 14000);
  assert.equal(await evaluate(openDialogs), 1);
  await snapshot("reminder-after-quick-view");
  checks.push("Countdown expires: reminder opens next as the sole open dialog with focus inside it.");
  assert.equal(await evaluate(`document.querySelector('[role=dialog][data-state=open]').contains(document.activeElement)`), true);
  await evaluate(`document.querySelector('[role=dialog][data-state=open] > button').click()`);
  await waitFor(`${openDialogs} === 0`);

  await evaluate(`window.renderFixture(900002,false)`);
  await waitFor(`(${dialogText}).includes('نظرة سريعة')`);
  await sleep(1800);
  await evaluate(`(() => {const until=performance.now()+9000;while(performance.now()<until){};return true;})()`);
  await waitFor(`${openDialogs} === 0`, 3000);
  checks.push("Nine-second main-thread stall does not stretch the ten-second deadline: dialog expires after the delayed callback.");
  await evaluate(`window.unmountFixture()`);
  assert.deepEqual(failures, []);
  const report = { result: "PASS", checks, limitations: [
    "Browser used real React/Radix components and actual AuthProvider with synthetic intercepted API responses.",
    "No real account or project data was read or written; production was not accessed.",
    "Synthetic diagnostics prove metadata recovery, not the cause of any unreproduced historical application failure.",
  ] };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket.close();
  await fetch(`http://127.0.0.1:9222/json/close/${target.id}`);
}
