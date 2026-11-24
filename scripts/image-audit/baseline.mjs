import { fork, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { fixtures, distribution, save, root } from "./common.mjs";

if (process.env.NODE_ENV === "production") throw new Error("Development benchmark only");
const manifest = await fixtures();
const rssLimit = 700 * 1024 * 1024;
const results = [];
for (const count of [1, 10, 20, 50]) {
  const result = await new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./processing-worker.mjs", import.meta.url)), [String(count)], {
      cwd: root, stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, NODE_ENV: "test" },
      execArgv: ["--max-old-space-size=256"],
    });
    const started = performance.now();
    let data, guardReason, peakRss = 0, stderr = "";
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on("message", message => { if (message.kind === "result") data = message; });
    child.on("error", reject);
    // Parent-side /proc sampling still works if the measured process is busy.
    const timer = setInterval(async () => {
      try {
        const status = await readFile(`/proc/${child.pid}/status`, "utf8");
        const rss = Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) * 1024;
        peakRss = Math.max(peakRss, rss);
        if (rss > rssLimit || performance.now() - started > 120_000) {
          guardReason = rss > rssLimit ? "rss_safety_limit" : "120s_safety_limit";
          child.kill("SIGKILL");
        }
      } catch { /* Process may have just exited. */ }
    }, 25);
    child.on("exit", (code, signal) => {
      clearInterval(timer);
      if (!data && !guardReason) return reject(new Error(`Benchmark worker failed (${code}/${signal}): ${stderr}`));
      resolve({
        count, status: guardReason ? "BLOCKED" : data.rows.every(r => r.status === "PASS") ? "PASS" : "FAIL",
        guardReason: guardReason ?? null, peakRss, wallMs: performance.now() - started,
        ...(data ?? {}), imageLatencyMs: distribution(data?.rows.map(row => row.totalMs) ?? []),
      });
    });
  });
  results.push(result);
  await save("processing-baseline.json", {
    recordedAt: new Date().toISOString(),
    sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    node: process.version, fixtures: manifest, rssLimit, results,
    scope: "Isolated real Sharp/variant processor; upload initial encode reproduced from files.ts. NOT an end-to-end API or multi-user test.",
    safety: "No database, bucket, user image, production endpoint or existing file accessed. Parent terminates unsafe child.",
  });
  console.log(JSON.stringify({ count, status: result.status, peakRss: result.peakRss, elapsedMs: result.elapsedMs, guardReason: result.guardReason }));
}
