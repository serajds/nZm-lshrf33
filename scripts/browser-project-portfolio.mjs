// Render the actual React UI; intercept ALL API traffic with isolated fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const origin = "http://127.0.0.1:22349";
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let seq = 0, failList = false, failSave = false, role = "admin", listRequests = 0;
const pending = new Map(), errors = [], writes = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++seq, { resolve, reject }); ws.send(JSON.stringify({ id: seq, method, params }));
});
let categories = [{ id: 10, name: "مرافق" }, { id: 20, name: "مبانٍ" }];
const basic = { location: "مصراتة", ownerEntity: "المالك الأول", contractor: "مقاول", supervisorEntity: "مشرف", noSchedule: true,
  startDate: null, expectedEndDate: null, overallProgress: 31, createdAt: "2026-01-01", updatedAt: "2026-01-01", status: "active",
  parentProjectId: null, categoryId: null, categoryName: null, portfolioRelation: "independent", canManage: true };
let projects = [
  { ...basic, id: 1, name: "المجمع الرئيسي", portfolioRelation: "main", overallProgress: 75, categoryId: 20, categoryName: "مبانٍ" },
  { ...basic, id: 2, name: "شبكات المياه", portfolioRelation: "child", parentProjectId: 1, categoryId: 10, categoryName: "مرافق", status: "delayed", overallProgress: 20 },
  { ...basic, id: 3, name: "مبنى الخدمات", portfolioRelation: "child", parentProjectId: 1, categoryId: 20, categoryName: "مبانٍ" },
  { ...basic, id: 4, name: "حديقة مستقلة", ownerEntity: "المالك الثاني" },
  { ...basic, id: 5, name: "فرعي آخر متاح", portfolioRelation: "child" },
];
function listRows() {
  const rows = role === "admin" ? projects : projects.filter(p => [2, 4, 5].includes(p.id));
  const visible = new Set(rows.map(p => p.id));
  return rows.map(p => ({ ...p, parentProjectId: visible.has(p.parentProjectId) ? p.parentProjectId : null, canManage: role === "admin" || p.id === 2 }));
}
ws.addEventListener("message", async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p?.reject(new Error(msg.error.message)) : p?.resolve(msg.result); return; }
  if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description);
  if (msg.method !== "Fetch.requestPaused") return;
  const { requestId, request } = msg.params;
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/")) { await send("Fetch.continueRequest", { requestId }); return; }
  let status = 200, body = [];
  try {
    if (path === "/api/auth/me") body = { id: 900000, role, phone: "fixture", fullName: "اختبار معزول" };
    else if (path === "/api/projects" && request.method === "GET") {
      listRequests++;
      if (failList) { status = 500; body = { error: "فشل شبكة تجريبي" }; } else body = listRows();
    } else if (path.startsWith("/api/project-categories")) {
      if (request.method === "GET") body = categories;
      else {
        const payload = request.postData ? JSON.parse(request.postData) : {};
        const id = Number(path.split("/").at(-1));
        writes.push({ method: request.method, path, payload });
        if (request.method === "POST") { body = { id: 30, name: payload.name }; categories.push(body); status = 201; }
        else if (request.method === "PATCH") { body = categories.find(c => c.id === id); body.name = payload.name; }
        else { categories = categories.filter(c => c.id !== id); for (const p of projects) if (p.categoryId === id) { p.categoryId = null; p.categoryName = null; } status = 204; }
      }
    } else if (/^\/api\/projects\/\d+$/.test(path)) {
      const id = Number(path.split("/").at(-1)), p = projects.find(p => p.id === id);
      if (request.method === "GET") body = { ...listRows().find(row => row.id === id), onedriveTestResultsFolderId: "original-folder" };
      else if (request.method === "PATCH") {
        const payload = JSON.parse(request.postData); writes.push({ method: "PATCH", path, payload });
        if (failSave) { failSave = false; status = 409; body = { error: "اختبار تعذر الحفظ دون فقد المدخلات" }; }
        else { Object.assign(p, payload); p.portfolioRelation = p.parentProjectId == null ? "independent" : "child"; body = p; }
      } else { writes.push({ method: request.method, path }); projects = projects.filter(p => p.id !== id); status = 204; }
    } else if (path === "/api/projects" && request.method === "POST") {
      const payload = JSON.parse(request.postData); writes.push({ method: "POST", path, payload });
      body = { ...basic, ...payload, id: 6, portfolioRelation: payload.parentProjectId ? "child" : "independent" }; projects.push(body); status = 201;
    } else if (path.includes("settings")) body = {};
    else if (path.includes("permissions")) body = { role: "project_manager", isProjectManager: true };
    await send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: status === 204 ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
  } catch (e) { errors.push(e.message); await send("Fetch.failRequest", { requestId, errorReason: "Failed" }); }
});
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
async function wait(expression) {
  for (let n = 0; n < 150; n++) { if (await ev(`Boolean(${expression})`)) return; await delay(100); }
  throw new Error(`Timeout ${expression}; ${errors}; ${(await ev("document.body.innerText")).slice(0,1800)}`);
}
const btn = text => `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
const aria = label => `document.querySelector('[aria-label="${label}"]')`;
const dialogBtn = text => `Array.from(document.querySelector('[role="dialog"]')?.querySelectorAll('button')??[]).find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
async function click(expr) {
  await wait(expr);
  await ev(`(${expr}).scrollIntoView({block:'center',behavior:'instant'})`);
  await delay(200);
  const p = await ev(`(()=>{const r=(${expr}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
}
async function input(selector, value) {
  await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
}
async function select(expr, text) {
  await click(expr);
  const option = `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.includes(${JSON.stringify(text)}))`;
  await wait(option); await delay(200); await click(option); await delay(100);
}
async function action(project, label) {
  await click(aria(`إجراءات ${project}`));
  await click(aria(label));
}
async function shot(name) {
  await mkdir("generated-artifacts/portfolio", { recursive: true });
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(`generated-artifacts/portfolio/${name}.png`, Buffer.from(r.data, "base64"));
}
async function checkPageFooter(name) {
  await wait(`document.querySelector('footer[aria-label="تذييل الصفحة"]')`);
  await delay(500); // Let route entrance animations and viewport resizing settle.
  assert.equal(await ev(`document.querySelectorAll('footer[aria-label="تذييل الصفحة"]').length`), 1, "shared footer must not be duplicated");
  assert.ok(await ev(`(() => {
    const footer = document.querySelector('footer[aria-label="تذييل الصفحة"]');
    const grid = document.querySelector('[aria-label="بطاقات المشاريع"]');
    return !grid || footer.getBoundingClientRect().top - grid.getBoundingClientRect().bottom >= 39;
  })()`), "footer must have space below project cards");
  await ev(`document.querySelector('footer[aria-label="تذييل الصفحة"]').scrollIntoView({block:'end'})`);
  await delay(250);
  await shot(name);
  const footerBounds = await ev(`(() => {
    const r = document.querySelector('footer[aria-label="تذييل الصفحة"]').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width, viewport: innerHeight, viewportWidth: innerWidth };
  })()`);
  assert.ok(await ev(`(() => {
    const r = document.querySelector('footer[aria-label="تذييل الصفحة"]').getBoundingClientRect();
    return r.top >= -1 && r.bottom <= innerHeight + 1 && r.width <= innerWidth + 1;
  })()`), `footer must be reachable without clipping or horizontal overflow: ${JSON.stringify(footerBounds)}`);
  await ev(`(() => {let el=document.querySelector('footer[aria-label="تذييل الصفحة"]').parentElement;while(el){if(el.scrollHeight>el.clientHeight)el.scrollTop=0;el=el.parentElement}})()`);
}
async function reload() {
  const previousOrigin = await ev("performance.timeOrigin");
  await send("Page.reload", { ignoreCache: true });
  await wait(`performance.timeOrigin !== ${previousOrigin} && document.readyState === 'complete'`);
  await wait(`Array.from(document.querySelectorAll('h1')).some(h=>h.textContent.trim() === 'المشاريع')`);
}
try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear();localStorage.setItem("auth_token","portfolio-fixture");localStorage.setItem("auth_session_v1",JSON.stringify({token:"portfolio-fixture",revision:1,sessionId:"portfolio-fixture",updatedAt:Date.now()}));` });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${origin}/projects` });
  await wait(aria("بحث في المشاريع"));
  await wait(`document.querySelector('[aria-label="بطاقات المشاريع"]')`);
  assert.equal(await ev(`document.querySelectorAll('[aria-label="بطاقات المشاريع"] > article').length`), 3);
  assert.equal(await ev(`document.querySelector('[aria-label="المشاريع المستقلة"]') !== null`), false);
  assert.equal(await ev(`Array.from(document.querySelectorAll('h1')).some(h => h.textContent.trim() === 'المشاريع')`), true);
  assert.equal(await ev(`document.body.innerText.includes('كل مشروع بجدوله المستقل، مجمّعة تنظيمياً تحت مشاريعها الرئيسية')`), false);
  // More than four children must be visible immediately, without expanding.
  projects.push(...[6, 7, 8].map(id => ({ ...basic, id, name: `فرعي تجريبي ${id}`, portfolioRelation: "child", parentProjectId: 1 })));
  await reload();
  await wait(`document.querySelectorAll('[aria-label="المشاريع الفرعية لـ المجمع الرئيسي"] > li').length === 5`);
  await checkPageFooter("desktop-footer");
  await shot("desktop");
  projects = projects.filter(p => p.id < 6);
  await reload();
  await wait(`document.querySelectorAll('[aria-label="المشاريع الفرعية لـ المجمع الرئيسي"] > li').length === 2`);
  assert.ok((await ev(`document.body.innerText`)).includes("نسبة الإنجاز"));
  assert.ok(!(await ev(`document.body.innerText`)).includes("متوسط"));
  const initialRequests = listRequests;
  await input('[aria-label="بحث في المشاريع"]', "شبكات المياه");
  await wait(`document.querySelector('[data-context="true"]')`);
  assert.equal(await ev(`document.querySelector('[data-context="true"]').innerText.includes('%75.0')`), true);
  assert.equal(await ev(`document.body.innerText.includes('مبنى الخدمات')`), false);
  assert.equal(listRequests, initialRequests, "filters must not refetch list or introduce N+1");
  await select(aria("الحالة"), "منحرف عن الخطة");
  await select(aria("التصنيف"), "مرافق");
  await select(aria("الجهة المالكة"), "المالك الأول");
  await select(aria("نوع الارتباط"), "فرعية");
  assert.equal(await ev(`document.querySelectorAll('[data-context="true"]').length`), 1);
  await click(btn("جدول مقارنة"));
  await wait(`document.querySelector('tbody')`);
  assert.equal(await ev(`document.querySelectorAll('tbody tr').length`), 1);
  assert.ok((await ev(`document.querySelector('tbody').innerText`)).includes("المجمع الرئيسي"));
  await click(btn("مسح التصفية"));
  await click(btn("المحفظة"));
  // Main collapsible control and state.
  const toggle = `document.querySelector('[aria-controls="children-of-1"]')`;
  await click(toggle); assert.equal(await ev(`${toggle}.getAttribute('aria-expanded')`), "false");
  await click(toggle); assert.equal(await ev(`${toggle}.getAttribute('aria-expanded')`), "true");
  // Edit fetches full details before submit, failed submit retains form.
  await action("شبكات المياه", "تعديل شبكات المياه");
  await wait(`document.querySelector('input[name="name"]')`);
  assert.equal(await ev(`document.querySelector('input[value="original-folder"]')!==null`), true);
  await input('input[name="name"]', "شبكات المياه المعدلة");
  const formSelect = name => `document.getElementById(Array.from(document.querySelectorAll('[role="dialog"] label')).find(l=>l.textContent.includes(${JSON.stringify(name)})).htmlFor)`;
  await select(formSelect("المشروع الرئيسي"), "حديقة مستقلة");
  await select(formSelect("التصنيف"), "مبانٍ");
  failSave = true;
  await click(dialogBtn("حفظ تعديلات المشروع"));
  await wait(`document.body.innerText.includes('اختبار تعذر الحفظ')`);
  assert.equal(await ev(`document.querySelector('input[name="name"]').value`), "شبكات المياه المعدلة");
  await click(dialogBtn("حفظ تعديلات المشروع"));
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal(writes.at(-1).payload.onedriveTestResultsFolderId, "original-folder");
  assert.equal(writes.at(-1).payload.parentProjectId, 4);
  assert.equal(writes.at(-1).payload.categoryId, 20);
  await action("شبكات المياه المعدلة", "فك شبكات المياه المعدلة من المشروع الرئيسي");
  await wait(`document.body.innerText.includes('أصبح «شبكات المياه المعدلة» مشروعاً مستقلاً')`);
  // Admin add-child form retains parent preset; use no-schedule and manual entities.
  await action("المجمع الرئيسي", "إضافة مشروع فرعي إلى المجمع الرئيسي");
  await wait(`document.querySelector('input[name="name"]')`);
  for (const [name, value] of Object.entries({ name: "فرع جديد", location: "مصراتة", ownerEntity: "مالك", supervisorEntity: "مشرف", contractor: "مقاول" })) await input(`input[name="${name}"]`, value);
  await click(`document.querySelector('[role="dialog"] [role="switch"]')`);
  await click(dialogBtn("تأكيد إضافة المشروع"));
  await wait(`!document.querySelector('[role="dialog"]')`);
  const createWrite = writes.find(w => w.method === "POST" && w.path === "/api/projects");
  assert.equal(createWrite.payload.parentProjectId, 1);
  assert.equal(createWrite.payload.noSchedule, true);
  // Catalog create, rename and non-destructive delete.
  await click(btn("إدارة التصنيفات"));
  await wait(`document.querySelector('input[placeholder^="اسم تصنيف جديد"]')`);
  await input('input[placeholder^="اسم تصنيف جديد"]', "تصنيف اختبار");
  failList = true;
  await click(dialogBtn("إضافة"));
  await wait(aria("تعديل تصنيف اختبار"));
  await wait(`document.body.innerText.includes('البيانات المعروضة من آخر تحميل ناجح')`);
  assert.equal(await ev(`document.body.innerText.includes('المجمع الرئيسي')`), true);
  failList = false;
  await click(aria("تعديل تصنيف اختبار"));
  await input('[role="dialog"] li input', "تصنيف معدل");
  await click(aria("حفظ"));
  await wait(aria("حذف تصنيف معدل"));
  await click(aria("حذف تصنيف معدل"));
  await click(dialogBtn("حذف"));
  await wait(`!document.querySelector('[aria-label="حذف تصنيف معدل"]')`);
  await click(`document.querySelector('[role="dialog"] button.absolute')`);
  await wait(`!document.querySelector('[role="dialog"]')`);
  await delay(350);
  // Arithmetic delete confirmation keeps existing behavior.
  await action("حديقة مستقلة", "حذف حديقة مستقلة");
  await wait(`document.getElementById('delete-project-math')`);
  const alertDelete = `Array.from(document.querySelector('[role="alertdialog"]').querySelectorAll('button')).find(b=>b.textContent.trim()==='حذف المشروع')`;
  assert.equal(await ev(`${alertDelete}.disabled`), true);
  const answer = await ev(`(()=>{const t=document.querySelector('[role="alertdialog"] p[dir="ltr"]').textContent;return t.match(/\\d+/g).map(Number).reduce((a,b)=>a+b)})()`);
  await input("#delete-project-math", String(answer));
  await click(alertDelete);
  await wait(`!document.querySelector('[role="alertdialog"]')`);
  // Hard reload fixture state persists, then mobile no overflow in cards/table/form.
  await reload(); await wait(aria("بحث في المشاريع"));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await checkPageFooter("mobile-footer");
  await shot("mobile");
  assert.ok(await ev(`document.documentElement.scrollWidth<=innerWidth`), "mobile cards overflow");
  await click(btn("جدول مقارنة"));
  assert.ok(await ev(`document.documentElement.scrollWidth<=innerWidth`), "mobile table overflow");
  await click(btn("المحفظة"));
  await click(btn("مشروع جديد"));
  await wait(`document.querySelector('input[name="name"]')`);
  assert.ok(await ev(`document.documentElement.scrollWidth<=innerWidth`), "mobile form overflow");
  await click(dialogBtn("إلغاء والتراجع"));
  // Scoped manager does not gain global create/delete/parent/catalog.
  role = "engineer"; await reload(); await wait(aria("إجراءات شبكات المياه المعدلة"));
  assert.equal(await ev(`Boolean(${btn("مشروع جديد")})`), false);
  assert.equal(await ev(`Boolean(${btn("إدارة التصنيفات")})`), false);
  assert.equal(await ev(`document.querySelectorAll('button[aria-label^="حذف "]').length`), 0);
  assert.equal(await ev(`document.body.innerText.includes('المجمع الرئيسي')`), false);
  await action("شبكات المياه المعدلة", "تعديل شبكات المياه المعدلة");
  await wait(`document.querySelector('input[name="name"]')`);
  assert.equal(await ev(`document.querySelector('[role="dialog"]').innerText.includes('المشروع الرئيسي')`), false);
  await click(dialogBtn("حفظ تعديلات المشروع"));
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal("parentProjectId" in writes.at(-1).payload, false);
  // Cold failure must be an explicit error, no empty list/counters.
  failList = true; await reload();
  await wait(`document.body.innerText.includes('تعذر تحميل المشاريع')`);
  assert.equal(await ev(`document.body.innerText.includes('لا توجد مشاريع بعد')`), false);
  failList = false; await click(btn("إعادة المحاولة")); await wait(aria("بحث في المشاريع"));
  projects = []; await reload();
  await wait(`document.body.innerText.includes('لا توجد مشاريع بعد')`);
  await checkPageFooter("empty-footer");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  await shot("empty-desktop-footer");
  const shortPageBounds = await ev(`(() => {
    const footer = document.querySelector('footer[aria-label="تذييل الصفحة"]');
    return { bottom: footer.getBoundingClientRect().bottom, height: innerHeight, parents: [footer.parentElement, footer.parentElement.parentElement].map(el=>({height:el.clientHeight, scrollHeight:el.scrollHeight, top:el.getBoundingClientRect().top})) };
  })()`);
  assert.ok(shortPageBounds.bottom >= shortPageBounds.height - 60, `short projects page must fill the content area: ${JSON.stringify(shortPageBounds)}`);
  assert.equal(await ev(`document.body.innerText.includes('تعذر تحميل المشاريع')`), false);
  role = "admin";
  for (const path of ["/companies", "/users"]) {
    await send("Page.navigate", { url: `${origin}${path}` });
    await wait(`location.pathname === '${path}' && document.readyState === 'complete' && document.querySelector('footer[aria-label="تذييل الصفحة"]')`);
    await checkPageFooter(path === "/companies" ? "companies-footer" : "users-footer");
  }
  await send("Emulation.setEmulatedMedia", { media: "print" });
  assert.equal(await ev(`getComputedStyle(document.querySelector('footer[aria-label="تذييل الصفحة"]')).display`), "none");
  await send("Emulation.setEmulatedMedia", { media: "" });
  assert.deepEqual(errors, []);
  console.log("PASS portfolio UI: composed filters/context, original parent progress, table, collapse, create noSchedule child, edit/retry/full detail, mobile, role gates, hard reload, network error; all APIs isolated");
} finally {
  await send("Page.close").catch(() => {}); ws.close();
}
