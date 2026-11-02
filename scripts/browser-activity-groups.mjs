// Requires an isolated Chromium debugging session on port 9222 and development
// Vite on 22349. All API traffic is mocked; no database or production access.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const origin = "http://127.0.0.1:22349";
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
let serial = 0;
const pending = new Map(), errors = [];
const reorderMode = process.argv.includes("--reorder");
const categoryMode = process.argv.includes("--categories");
const categories = [];
let failNextCategory = false;
let reorderRequests = 0, failNextReorder = false;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  pending.set(++serial, { resolve, reject });
  ws.send(JSON.stringify({ id: serial, method, params }));
});
const groups = [
  { id: 101, projectId: 7, name: "مجموعة الاختبار الأولى", color: "#2563eb", sortOrder: 0 },
  { id: 102, projectId: 7, name: "مجموعة الاختبار الثانية", color: "#15803d", sortOrder: 1 },
  { id: 103, projectId: 7, name: "مجموعة فارغة", color: "#475569", sortOrder: 2 },
];
const activities = [101, 102, null].map((groupId, index) => ({
  id: index + 1, projectId: 7, name: `بند تجريبي ${index + 1}`, groupId,
  status: index === 1 ? "completed" : "not_started", weight: 1, actualProgress: index === 1 ? 100 : 0, plannedProgress: 0,
  plannedStartDate: "2026-11-01", plannedEndDate: "2026-12-01",
  actualStartDate: null, actualEndDate: null, sortOrder: index,
}));
const user = { id: 900001, fullName: "اختبار فلتر المجموعات", role: "admin", phone: "0000000000" };
if (reorderMode) activities.push(
  { ...activities[0], id: 4, name: "بند سحب ثان", sortOrder: 3 },
  { ...activities[0], id: 5, name: "بند سحب ثالث", sortOrder: 4 },
);
ws.addEventListener("message", async event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const task = pending.get(message.id);
    pending.delete(message.id);
    message.error ? task?.reject(new Error(message.error.message)) : task?.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description);
  if (message.method !== "Fetch.requestPaused") return;
  const { requestId, request } = message.params;
  const path = new URL(request.url).pathname;
  try {
    if (!path.startsWith("/api/")) return void await send("Fetch.continueRequest", { requestId });
    if (path.includes("/activity-group-categories") && request.method !== "GET") {
      let responseBody = {}, status = 200;
      if (failNextCategory) {
        failNextCategory = false; status = 500; responseBody = { error: "اختبار فشل تصنيف معزول" };
      } else if (path.endsWith("/assign")) {
        const body = JSON.parse(request.postData);
        let category = categories.find(category => category.id === body.categoryId) ?? null;
        if (body.newCategoryName) {
          category = categories.find(category => category.name === body.newCategoryName) ?? {
            id: 501 + categories.length, projectId: 7, name: body.newCategoryName, sortOrder: categories.length,
          };
          if (!categories.includes(category)) categories.push(category);
        }
        for (const id of body.groupIds) groups.find(group => group.id === id).categoryId = category?.id ?? null;
        responseBody = { category, updated: body.groupIds.length };
      } else {
        const id = Number(path.split("/").at(-1));
        const category = categories.find(category => category.id === id);
        if (request.method === "PATCH") category.name = JSON.parse(request.postData).name;
        if (request.method === "DELETE") {
          categories.splice(categories.indexOf(category), 1);
          for (const group of groups) if (group.categoryId === id) group.categoryId = null;
        }
        responseBody = { success: true };
      }
      await send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(responseBody)).toString("base64") });
      return;
    }
    if (request.method === "PUT" && path.endsWith("/activities/reorder")) {
      reorderRequests++;
      const items = JSON.parse(request.postData).items;
      assert.ok(items.every(item => !("groupId" in item)), "A reorder must never transfer group ownership");
      const failed = failNextReorder;
      failNextReorder = false;
      if (!failed) {
        for (const item of items) activities.find(row => row.id === item.id).sortOrder = item.sortOrder;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      await send("Fetch.fulfillRequest", { requestId, responseCode: failed ? 500 : 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(failed ? { error: "فشل تجريبي معزول" } : { updated: items.length })).toString("base64") });
      return;
    }
    let body = [];
    if (path === "/api/auth/me") body = user;
    else if (path === "/api/projects/7") body = { id: 7, name: "اختبار معزول للمجموعات",
      startDate: "2026-11-01", expectedEndDate: "2026-12-01", status: "in_progress", overallProgress: 0 };
    else if (path.endsWith("/activity-groups")) body = groups;
    else if (path.endsWith("/activity-group-categories")) body = categories;
    else if (path.endsWith("/activities")) body = [...activities].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    else if (path.includes("permissions")) body = { role: "project_manager", isProjectManager: true, tabPermissions: { activities: "edit" } };
    else if (path.endsWith("/my-activity-reminder/claim")) body = { show: false };
    else if (path.includes("settings")) body = {};
    await send("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") });
  } catch (error) { errors.push(error.message); }
});
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout: ${expression}\n${JSON.stringify(errors)}`);
}
const groupButton = name => `Array.from(document.querySelectorAll('button[aria-label]')).find(button=>button.getAttribute('aria-label')===${JSON.stringify(name)})`;
const tableText = () => evaluate(`document.querySelector('[aria-label="جدول بنود الأعمال قابل للتمرير أفقياً"]').innerText`);
const rowNames = `Array.from(document.querySelectorAll('tbody tr')).map(row=>row.innerText).filter(text=>text.includes('بند تجريبي 1')||text.includes('بند سحب'))`;
async function rowHandle(name) {
  return `Array.from(document.querySelectorAll('tbody tr')).find(row=>row.innerText.includes(${JSON.stringify(name)}))?.querySelector('button[aria-label="سحب لتغيير الترتيب"]')`;
}
async function pointerDrag(fromName, toName) {
  await evaluate(`(${await rowHandle(fromName)}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
  const point = async name => evaluate(`(() => {const r=(${await rowHandle(name)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const from = await point(fromName), to = await point(toName);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", clickCount: 1 });
  for (let step = 1; step <= 12; step++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + (to.x - from.x) * step / 12,
      y: from.y + (to.y - from.y) * step / 12, buttons: 1 });
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
}
async function keyboard(key, code, keyCode) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
  await new Promise(resolve => setTimeout(resolve, 100));
}
const buttonText = (text, root = "document") => `Array.from((${root})?.querySelectorAll('button') ?? []).find(button=>button.textContent.includes(${JSON.stringify(text)}))`;
const categoryButton = name => buttonText(name, `document.querySelector('[aria-label="فلتر التصنيفات الرئيسية"]')`);
async function setInput(selector, value) {
  await evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
}
async function pointerClick(expression) {
  await evaluate(`${expression}.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`);
  const point = await evaluate(`(() => {const rect=${expression}.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function openOrganizer() {
  await evaluate(`${buttonText("تنظيم")}.click()`);
  await wait(`Boolean(document.getElementById('org-g-101'))`);
  await new Promise(resolve => setTimeout(resolve, 300));
}
async function chooseTarget(text) {
  await pointerClick(`document.getElementById('org-target')`);
  const option = `Array.from(document.querySelectorAll('[role="option"]')).find(option=>option.textContent.includes(${JSON.stringify(text)}))`;
  await wait(`Boolean(${option})`);
  await new Promise(resolve => setTimeout(resolve, 200));
  await pointerClick(option);
}
async function saveClassification(count, release = false) {
  const button = buttonText(`${release ? "إزالة تصنيف" : "تصنيف"} ${count} مجموعة`, `document.querySelector('[role="dialog"]')`);
  await wait(`Boolean(${button})`);
  await evaluate(`${button}.click()`);
}
try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.clear();
    localStorage.setItem('auth_token','synthetic-filter-token');
    localStorage.setItem('auth_session_v1',JSON.stringify({token:'synthetic-filter-token',revision:1,sessionId:'synthetic-filter-session',updatedAt:Date.now()}));
    localStorage.setItem('auth_user_cache',JSON.stringify({token:'synthetic-filter-token',sessionId:'synthetic-filter-session',user:${JSON.stringify(user)}}));
  ` });
  await send("Page.navigate", { url: `${origin}/projects/7/activities` });
  const firstButton = groupButton(`عرض مجموعة مجموعة الاختبار الأولى، ${reorderMode ? 3 : 1} بند`);
  await wait(firstButton);
  if (categoryMode) {
    const originalActivities = JSON.stringify(activities);
    await openOrganizer();
    await setInput('[aria-label="بحث في المجموعات"]', "الأولى");
    await wait(`Boolean(document.getElementById('org-g-101')) && !document.getElementById('org-g-102')`);
    await pointerClick(`document.getElementById('org-g-101')`);
    await wait(`document.getElementById('org-g-101').getAttribute('data-state')==='checked'`);
    await setInput('[aria-label="بحث في المجموعات"]', "الثانية");
    await wait(`Boolean(document.getElementById('org-g-102')) && !document.getElementById('org-g-101')`);
    await pointerClick(`document.getElementById('org-g-102')`);
    await wait(`document.getElementById('org-g-102').getAttribute('data-state')==='checked'`);
    await setInput("#org-new", "الأعمال المعمارية");
    await saveClassification(2);
    await wait(`!document.querySelector('[role="dialog"]') && Boolean(${categoryButton("الأعمال المعمارية")})`);
    assert.deepEqual(groups.map(group => group.categoryId ?? null), [501, 501, null]);
    await evaluate(`${categoryButton("الأعمال المعمارية")}.click()`);
    const index = `document.querySelector('[aria-label="فهرس مجموعات بنود الأعمال"]').innerText`;
    await wait(`!(${index}).includes('مجموعة فارغة')`);
    let text = await tableText();
    assert.ok(text.includes("بند تجريبي 1") && text.includes("بند تجريبي 2") && !text.includes("بند تجريبي 3"));
    await evaluate(`${firstButton}.click()`);
    text = await tableText();
    assert.ok(text.includes("بند تجريبي 1") && !text.includes("بند تجريبي 2"));
    await send("Page.reload", { ignoreCache: true });
    await wait(`Boolean(${categoryButton("الأعمال المعمارية")})`);
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`${categoryButton("الأعمال المعمارية")}.click()`);
    await wait(`!(${index}).includes('مجموعة فارغة')`);
    await evaluate(`${groupButton("عرض مجموعة مجموعة الاختبار الثانية، 1 بند")}.click()`);
    await wait(`document.body.innerText.includes('بند تجريبي 2') && !document.body.innerText.includes('بند تجريبي 1')`);
    await evaluate(`${categoryButton("بدون تصنيف")}.click()`);
    await wait(`document.body.innerText.includes('بند تجريبي 3') && !document.body.innerText.includes('بند تجريبي 2')`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await openOrganizer();
    await pointerClick(`document.getElementById('org-g-103')`);
    await setInput("#org-new", "أعمال الكهرباء");
    failNextCategory = true;
    await saveClassification(1);
    await wait(`document.querySelector('[role="dialog"]').innerText.includes('اختبار فشل تصنيف معزول')`);
    assert.equal(categories.length, 1);
    await saveClassification(1);
    await wait(`!document.querySelector('[role="dialog"]') && Boolean(${categoryButton("أعمال الكهرباء")})`);
    await openOrganizer();
    await pointerClick(`document.getElementById('org-g-101')`);
    await chooseTarget("أعمال الكهرباء");
    await saveClassification(1);
    await wait(`!document.querySelector('[role="dialog"]')`);
    assert.deepEqual(groups.map(group => group.categoryId ?? null), [502, 501, 502]);
    await openOrganizer();
    await pointerClick(`document.getElementById('org-g-101')`);
    await chooseTarget("إزالة التصنيف");
    await saveClassification(1, true);
    await wait(`!document.querySelector('[role="dialog"]')`);
    assert.deepEqual(groups.map(group => group.categoryId ?? null), [null, 501, 502]);
    await evaluate(`${buttonText("إدارة التصنيفات")}.click()`);
    const renameButton = `document.querySelector('[aria-label="إعادة تسمية أعمال الكهرباء"]')`;
    await wait(`Boolean(${renameButton})`);
    await evaluate(`${renameButton}.click()`);
    await setInput('[aria-label="اسم جديد للتصنيف أعمال الكهرباء"]', "الكهرباء الرئيسية");
    await evaluate(`${buttonText("حفظ", `document.querySelector('[role="dialog"]')`)}.click()`);
    await wait(`Boolean(document.querySelector('[aria-label="حذف الكهرباء الرئيسية"]'))`);
    await evaluate(`document.querySelector('[aria-label="حذف الكهرباء الرئيسية"]').click()`);
    await wait(`Boolean(document.querySelector('[role="alertdialog"]'))`);
    await evaluate(`${buttonText("حذف التصنيف", `document.querySelector('[role="alertdialog"]')`)}.click()`);
    await wait(`!document.querySelector('[role="alertdialog"]') && !document.querySelector('[aria-label="حذف الكهرباء الرئيسية"]')`);
    assert.deepEqual(groups.map(group => group.categoryId ?? null), [null, 501, null]);
    await keyboard("Escape", "Escape", 27);
    await wait(`!document.querySelector('[role="dialog"]')`);
    await evaluate(`${categoryButton("الأعمال المعمارية")}.click()`);
    assert.equal(JSON.stringify(activities), originalActivities);
    assert.deepEqual(errors, []);
    await mkdir("generated-artifacts/activity-group-filter", { recursive: true });
    await writeFile("generated-artifacts/activity-group-filter/category-organizer.png",
      Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    console.log("PASS: actual UI bulk/search/create/persisted reload/two-level desktop+mobile filters/failed-save retry/move to existing/release/rename/delete; activities unchanged; no browser exceptions. Synthetic APIs only.");
  } else if (reorderMode) {
    await pointerDrag("بند تجريبي 1", "بند سحب ثالث");
    await wait(`(${rowNames})[0]?.includes('بند سحب ثان') && (${rowNames})[2]?.includes('بند تجريبي 1')`);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(reorderRequests, 1);
    assert.deepEqual(activities.filter(row => row.groupId === 101).sort((a, b) => a.sortOrder - b.sortOrder).map(row => row.id), [4, 5, 1]);
    await send("Page.reload", { ignoreCache: true });
    await wait(firstButton);
    await wait(`(${rowNames})[0]?.includes('بند سحب ثان') && (${rowNames})[2]?.includes('بند تجريبي 1')`);
    await evaluate(`${firstButton}.click()`);
    failNextReorder = true;
    await pointerDrag("بند سحب ثان", "بند تجريبي 1");
    await wait(`document.body.innerText.includes('لم يُحفظ ترتيب البنود')`);
    await wait(`(${rowNames})[0]?.includes('بند سحب ثان') && (${rowNames})[2]?.includes('بند تجريبي 1')`);
    assert.equal(reorderRequests, 2);
    await evaluate(`(${await rowHandle("بند تجريبي 1")}).focus()`);
    await keyboard(" ", "Space", 32);
    await keyboard("ArrowUp", "ArrowUp", 38);
    await keyboard(" ", "Space", 32);
    await wait(`(${rowNames})[1]?.includes('بند تجريبي 1') && (${rowNames})[2]?.includes('بند سحب ثالث')`);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(reorderRequests, 3);
    assert.equal(activities.find(row => row.id === 2).groupId, 102);
    await mkdir("generated-artifacts/activity-group-filter", { recursive: true });
    await writeFile("generated-artifacts/activity-group-filter/reordered-activities.png",
      Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    assert.deepEqual(errors, []);
    console.log("PASS: real pointer drag; order survives reload; failed save restores prior order with message; keyboard drag; no group changes; no browser exceptions. All APIs isolated.");
  } else {
  await evaluate(`${firstButton}.click()`);
  await wait(`document.querySelector('[role=status]')?.innerText.includes('فلتر المجموعات مفعّل')`);
  let text = await tableText();
  assert.ok(text.includes(groups[0].name) && text.includes("بند تجريبي 1"));
  assert.ok(!text.includes(groups[1].name) && !text.includes(groups[2].name) && !text.includes("بند تجريبي 2"));
  assert.equal(await evaluate(`${firstButton}.getAttribute('aria-pressed')`), "true");
  assert.equal(await evaluate(`${firstButton}.parentElement.classList.contains('bg-primary')`), true);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobileText = await evaluate(`document.querySelector('[class*="md:hidden"][class*="space-y-3"][class*="px-3"]').innerText`);
  assert.ok(mobileText.includes(groups[0].name) && !mobileText.includes(groups[1].name));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('[role=status]').scrollIntoView({block:'center'})`);
  await mkdir("generated-artifacts/activity-group-filter", { recursive: true });
  await writeFile("generated-artifacts/activity-group-filter/selected-group.png",
    Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('إلغاء فلتر المجموعة')).click()`);
  await wait(`!document.querySelector('[role=status]')?.innerText.includes('فلتر المجموعات مفعّل')`);
  text = await tableText();
  assert.ok(text.includes(groups[1].name) && text.includes(groups[2].name));
  await evaluate(`${groupButton("عرض مجموعة مجموعة فارغة، 0 بند")}.click()`);
  await wait(`document.querySelector('[role=status]')?.innerText.includes('مجموعة فارغة')`);
  text = await tableText();
  assert.ok(!text.includes(groups[0].name) && !text.includes(groups[1].name) && !text.includes("بند تجريبي 1"));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('إلغاء فلتر المجموعة')).click()`);
  await evaluate(`${groupButton("تصفية الحالة: مكتمل")}.click()`);
  await wait(`document.querySelector('[aria-label="فلتر الحالة المفعّل"]')?.innerText.includes('مكتمل')`);
  text = await tableText();
  assert.ok(text.includes(groups[1].name) && text.includes("بند تجريبي 2"));
  assert.ok(!text.includes(groups[0].name) && !text.includes(groups[2].name));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const statusMobileText = await evaluate(`document.querySelector('[class*="md:hidden"][class*="space-y-3"][class*="px-3"]').innerText`);
  assert.ok(statusMobileText.includes(groups[1].name) && !statusMobileText.includes(groups[0].name));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('[aria-label="فلتر الحالة المفعّل"]').scrollIntoView({block:'center'})`);
  await writeFile("generated-artifacts/activity-group-filter/selected-status.png",
    Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await evaluate(`${groupButton("تصفية الحالة: قيد التنفيذ")}.click()`);
  await wait(`document.querySelector('[aria-label="فلتر الحالة المفعّل"]')?.innerText.includes('قيد التنفيذ')`);
  text = await tableText();
  assert.ok(!text.includes(groups[0].name) && !text.includes(groups[1].name));
  await evaluate(`${firstButton}.click()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('إلغاء فلتر الحالة')).click()`);
  await wait(`!document.querySelector('[aria-label="فلتر الحالة المفعّل"]')`);
  text = await tableText();
  assert.ok(text.includes(groups[0].name) && !text.includes(groups[1].name));
  assert.equal(await evaluate(`${firstButton}.getAttribute('aria-pressed')`), "true");
  assert.deepEqual(errors, []);
  console.log("PASS: real activity page, synthetic APIs: desktop/mobile group and status filters; clear indicators; nonmatching/empty groups hidden; zero-match status; status reset preserves group; no browser exceptions.");
  }
} finally {
  ws.close();
  await fetch(`http://127.0.0.1:9222/json/close/${target.id}`);
}
