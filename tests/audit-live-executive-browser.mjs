// Opt-in, DEVELOPMENT ONLY. Reads real data without submitting reminders or edits.
// Run: NODE_ENV=development node --import ./scripts/node_modules/tsx/dist/loader.mjs tests/audit-live-executive-browser.mjs
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createServer} from "node:net";
import {mkdtemp,rm,writeFile,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Cdp,until} from "./helpers/deviation-browser.mjs";
import {db,pool,usersTable} from "../lib/db/src/index.ts";
import {eq} from "../lib/db/node_modules/drizzle-orm/index.js";
import {signToken} from "../artifacts/api-server/src/lib/auth.ts";
assert.equal(process.env.NODE_ENV,"development");assert.notEqual(process.env.REPLIT_DEPLOYMENT,"1");
const origin=`https://${process.env.REPLIT_DEV_DOMAIN}`;
const output="generated-artifacts/summary-audit";
const profile=await mkdtemp(join(tmpdir(),"executive-readonly-"));
let browser,main;const connections=[];
try {
  const [u]=await db.select().from(usersTable).where(eq(usersTable.role,"admin")).limit(1);
  const token=signToken({userId:u.id,phone:u.phone,role:u.role});
  const response=await fetch(`${origin}/api/projects/1/deviation?curve=linear`,{headers:{Authorization:`Bearer ${token}`}});
  assert.equal(response.status,200);const expected=await response.json();
  const probe=createServer();probe.listen(0,"127.0.0.1");await once(probe,"listening");
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  browser=spawn("/repl/tools/bin/chromium",["--headless=new","--no-sandbox","--disable-gpu","--disable-popup-blocking",`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});
  const targets=async()=>fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  await until(()=>targets().then(a=>a.some(t=>t.type==="page")).catch(()=>false));
  const first=(await targets()).find(t=>t.type==="page");
  main=new Cdp(first.webSocketDebuggerUrl);connections.push(main);await once(main.ws,"open");
  await main.send("Page.enable");await main.send("Runtime.enable");
  await main.send("Page.addScriptToEvaluateOnNewDocument",{source:`
    localStorage.setItem("auth_token",${JSON.stringify(token)});
    localStorage.setItem("pwa-install-dismissed-at",String(Date.now()));
    const originalFetch=window.fetch.bind(window);
    window.fetch=(input,options={})=>{
      const url=typeof input==="string"?input:input.url;
      const method=String(options.method??input.method??"GET").toUpperCase();
      if(method!=="GET"&&method!=="HEAD"){
        if(url.includes("/my-activity-reminder/claim"))return Promise.resolve(Response.json({show:false}));
        return Promise.reject(new Error("Read-only browser audit blocked a write"));
      }
      return originalFetch(input,options);
    };
  `});
  await main.send("Emulation.setDeviceMetricsOverride",{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await main.send("Page.navigate",{url:`${origin}/projects/1`});
  const actualLabel=expected.actualProgress.toFixed(1)+"%";
  await until(()=>main.eval(`document.body?.innerText.includes(${JSON.stringify(actualLabel)})`));
  const previousDocument=await main.eval("performance.timeOrigin");
  await main.send("Page.reload",{ignoreCache:true});
  await until(()=>main.eval(`performance.timeOrigin!==${previousDocument}&&document.readyState==="complete"&&document.body?.innerText.includes(${JSON.stringify(actualLabel)})&&document.body?.innerText.includes(${JSON.stringify(expected.plannedProgress.toFixed(1)+"%")})`));
  const text=await main.eval("document.body.innerText");
  assert(text.includes(expected.plannedProgress.toFixed(1)+"%"));
  assert(!text.includes("لا يوجد انحراف صافٍ"));
  await mkdir(output,{recursive:true});
  const screenshot=async(cdp,name)=>{
    const r=await cdp.send("Page.captureScreenshot",{format:"jpeg",quality:75,captureBeyondViewport:false});
    await writeFile(`${output}/${name}.jpg`,Buffer.from(r.data,"base64"));
  };
  await main.eval('document.querySelectorAll(".surface-card")[0]?.scrollIntoView({block:"center"})');
  await screenshot(main,"overview-hard-refresh");
  const verifyPopup=async(label,name)=>{
    const before=new Set((await targets()).map(t=>t.id));
    assert(await main.eval(`(()=>{const button=[...document.querySelectorAll("button")].find(b=>b.innerText.includes(${JSON.stringify(label)}));if(!button)return false;button.click();return true;})()`));
    let popup;
    await until(async()=>{popup=(await targets()).find(t=>t.type==="page"&&!before.has(t.id));return Boolean(popup);});
    const cdp=new Cdp(popup.webSocketDebuggerUrl);connections.push(cdp);await once(cdp.ws,"open");await cdp.send("Runtime.enable");
    await until(()=>cdp.eval(`document.body?.innerText.includes(${JSON.stringify(expected.actualProgress.toFixed(2)+"%")})`));
    const body=await cdp.eval("document.body.innerText");
    assert(body.includes(expected.plannedProgress.toFixed(2)+"%"));assert(body.includes(expected.spi.toFixed(2)));
    assert(body.includes(expected.forecastCompletionDate));assert(body.includes(`${Math.abs(expected.forecastDelayDays)} يوم`));
    assert(!body.includes("2028-02-01"));assert(!body.includes("NaN"));
    await screenshot(cdp,name);assert.deepEqual(cdp.errors,[]);
    return {actual:expected.actualProgress.toFixed(2),planned:expected.plannedProgress.toFixed(2),spi:expected.spi.toFixed(2),forecast:expected.forecastCompletionDate};
  };
  const print=await verifyPopup("ملخص تنفيذي","printed-summary");
  const slides=await verifyPopup("عرض تقديمي","executive-slides");
  await main.send("Page.navigate",{url:`${origin}/projects/1/deviation`});
  await until(()=>main.eval('document.body?.innerText.includes("كيف يُحسب الانحراف")'));
  const deviation=await main.eval("document.body.innerText");assert(deviation.includes(expected.actualProgress.toFixed(2)));
  await screenshot(main,"deviation");
  assert.deepEqual(main.errors,[]);
  const result={status:"PASS",origin:"development",hardRefresh:true,print,slides,errors:[]};
  await writeFile(`${output}/browser.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {
  for(const c of connections)c.ws.close();
  browser?.kill("SIGTERM");if(browser&&browser.exitCode==null)await once(browser,"exit");
  await pool.end();await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
