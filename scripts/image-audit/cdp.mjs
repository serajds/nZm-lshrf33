import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { output } from "./common.mjs";

/** A private browser process/target; never attaches to a user's signed-in tab. */
export async function openAuditBrowser(origin) {
  const profile = await mkdtemp(path.join(output, "browser-profile-"));
  const child = spawn("chromium", [
    "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore" });
  let ws, target, sequence = 0;
  const pending = new Map();
  let spawnError;
  child.on("error", error => { spawnError = error; });
  const close = async () => {
    for (const entry of pending.values()) entry.reject(new Error("Audit browser closed"));
    pending.clear();
    ws?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exit = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
      await exit;
      clearTimeout(timer);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  };
  try {
    let port;
    for (let i = 0; i < 150; i++) {
      if (spawnError) throw spawnError;
      try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    if (!port) throw new Error("Private audit browser did not start");
    target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      message.error ? entry.reject(new Error("Audit browser command failed")) : entry.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("Audit browser connection failed")), { once: true });
    });
    const send = (method, params = {}, timeoutMs = 30_000) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id); reject(new Error(`Browser command timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, { timeoutMs = 30_000 } = {}) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      // Do not include exception descriptions: browser network exceptions may
      // contain signed URLs. Return only a non-sensitive failure here.
      if (result.exceptionDetails) throw new Error("Audit browser evaluation failed");
      return result.result.value;
    };
    await send("Page.enable");
    const destination = new URL(origin).href;
    await send("Page.navigate", { url: destination });
    for (let i = 0; i < 500; i++) {
      if (await evaluate(`location.href === ${JSON.stringify(destination)} && document.readyState === 'complete'`)) {
        return { send, evaluate, close };
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    let state = "unavailable";
    try { state = await evaluate("JSON.stringify({origin:location.origin,pathname:location.pathname,readyState:document.readyState})"); } catch { /* generic diagnostic only */ }
    throw new Error(`Audit browser document did not load (${state})`);
  } catch (error) {
    await close();
    throw error;
  }
}
