import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const output = path.join(root, "generated-artifacts/image-audit");
export const requireApi = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
export const sharp = requireApi("sharp");
const pageSizeBytes = Number(execFileSync("getconf", ["PAGESIZE"], { encoding: "utf8" }).trim());
if (!Number.isSafeInteger(pageSizeBytes) || pageSizeBytes < 1024) throw new Error("invalid_system_page_size");

// Bundle the real implementation, not a benchmark-specific replacement.
// Do not import app.ts/routes: those start maintenance workers on import.
export async function loadSource(relativePath, overrides = {}) {
  const { build } = requireApi("esbuild");
  const bundle = await build({
    entryPoints: [path.join(root, relativePath)],
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  });
  const module = { exports: {} };
  const require = name => name in overrides ? overrides[name] : requireApi(name);
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

export function distribution(values) {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (!sorted.length) return { n: 0, p50: null, p95: null, max: null };
  const quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { n: sorted.length, p50: quantile(.5), p95: quantile(.95), max: sorted.at(-1) };
}

export async function save(name, value) {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n");
}

export function summarizeMixedRequests(requests) {
  const uploadPhases = [...new Set(requests.map(row => row.phase)
    .filter(phase => /^upload-\d+$/.test(phase)))].sort((left, right) =>
      Number(left.slice(7)) - Number(right.slice(7)));
  return ["idle", ...uploadPhases].flatMap(phase =>
    [...new Set(requests.map(row => row.operation))].map(operation => {
      const group = requests.filter(row => row.phase === phase && row.operation === operation);
      const successfulItems = new Set(group.filter(row => row.status >= 200 && row.status < 300)
        .map(row => row.itemIndex).filter(Number.isSafeInteger));
      const recoveredRetries = row => operation === "upload" && [0, 408, 429, 500, 502, 503, 504].includes(row.status)
        && Number.isSafeInteger(row.itemIndex) && successfulItems.has(row.itemIndex);
      return {
        phase, operation, latencyMs: distribution(group.filter(row => row.status > 0).map(row => row.elapsedMs)),
        errors: group.filter(row => row.status >= 300 && !recoveredRetries(row)
          || (row.status === 0 && !row.abortedByGuard)).length,
        httpErrors: group.filter(row => row.status >= 300).length,
        recoveredRetries: group.filter(recoveredRetries).length,
        transportFailures: group.filter(row => row.status === 0 && !row.abortedByGuard).length,
        guardAborts: group.filter(row => row.abortedByGuard).length,
        statuses: [...new Set(group.map(row => row.status))],
      };
    }));
}

export function evaluateMixedAcceptance(summary, { minimumSamples = 30 } = {}) {
  const idle = new Map(summary.filter(row => row.phase === "idle")
    .map(row => [row.operation, row]));
  return summary.filter(row => /^upload-\d+$/.test(row.phase) && row.operation !== "upload")
    .map(row => {
      const baselineRow = idle.get(row.operation);
      const baseline = baselineRow?.latencyMs.p95;
      const baselineSampleCount = baselineRow?.latencyMs.n ?? 0;
      const thresholdMs = Number.isFinite(baseline) ? Math.max(100, baseline * 1.5) : null;
      const sampleCount = row.latencyMs.n;
      const state = row.errors > 0 || row.transportFailures > 0 ? "FAIL"
        : sampleCount < minimumSamples || baselineSampleCount < minimumSamples
          || thresholdMs === null || row.latencyMs.p95 === null ? "BLOCKED"
          : row.latencyMs.p95 <= thresholdMs ? "PASS" : "FAIL";
      return { phase: row.phase, operation: row.operation, sampleCount, baselineSampleCount, baselineP95Ms: baseline ?? null,
        thresholdMs, p95Ms: row.latencyMs.p95, state };
    });
}

/** Conservative sum of RSS, not unique physical memory/PSS. No cmdlines/env. */
export async function sampleProcessTree(rootPid, { includePss = false } = {}) {
  if (!/^[1-9][0-9]{0,8}$/.test(String(rootPid))) throw new Error("invalid_process_id");
  const statistics = new Map(), processes = [];
  let discoveryOmitted = 0, rssOmissions = 0;
  const rssOmissionReasons = {
    ownedPidMissingStat: 0, missingVmRss: 0, statusPermissionDenied: 0,
    missingStatm: 0, invalidStatm: 0, zeroStatm: 0,
    missingSmapsRollup: 0, invalidSmapsRollup: 0, zeroSmapsRollup: 0,
  };
  const rssOmissionStates = {};
  // task/PID/children is absent in this sandbox. Read PPID relationships from
  // /proc/PID/stat instead; never silently turn an unsupported file into 0 RSS.
  await Promise.all((await readdir("/proc")).filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const stat = await readFile(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      const row = {
        pid: Number(name), parent: Number(fields[1]), state: fields[0],
        cpuTicks: [11, 12, 13, 14].reduce((sum, index) => sum + Number(fields[index] ?? 0), 0),
      };
      if (!Number.isSafeInteger(row.parent) || !Number.isFinite(row.cpuTicks)) throw new Error("invalid_process_statistics");
      statistics.set(row.pid, row);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
      discoveryOmitted++;
    }
  }));
  const owned = new Set([Number(rootPid)]);
  for (let added = true; added;) {
    added = false;
    for (const row of statistics.values()) if (!owned.has(row.pid) && owned.has(row.parent)) {
      owned.add(row.pid); added = true;
    }
  }
  await Promise.all([...owned].map(async pid => {
    const row = statistics.get(pid);
    if (!row) { rssOmissions++; rssOmissionReasons.ownedPidMissingStat++; return; }
    try {
      const status = await readFile(`/proc/${pid}/status`, "utf8");
      const match = status.match(/VmRSS:\s+(\d+)/);
      if (match) {
        processes.push({ pid, state: row.state, rss: Number(match[1]) * 1024, rssSource: "status", cpuTicks: row.cpuTicks });
        return;
      }
      if (row.state === "Z") {
        processes.push({ pid, state: row.state, rss: 0, rssSource: "zombie", pssBytes: 0, cpuTicks: row.cpuTicks });
        return;
      }
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return;
      if (error.code !== "EACCES") throw error;
      rssOmissionReasons.statusPermissionDenied++;
    }
    try {
      const statm = (await readFile(`/proc/${pid}/statm`, "utf8")).trim().split(/\s+/);
      const residentPages = Number(statm[1]);
      if (statm.length < 2 || !Number.isSafeInteger(residentPages) || residentPages < 0) {
        rssOmissionReasons.invalidStatm++;
      } else if (residentPages === 0) {
        rssOmissionReasons.zeroStatm++;
      } else {
        processes.push({ pid, state: row.state, rss: residentPages * pageSizeBytes, rssSource: "statm", cpuTicks: row.cpuTicks });
        return;
      }
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return;
      if (error.code !== "EACCES") throw error;
      rssOmissionReasons.missingStatm++;
    }
    try {
      const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
      const match = rollup.match(/^Rss:\s+(\d+)\s+kB$/m);
      const rssKb = match ? Number(match[1]) : NaN;
      if (Number.isSafeInteger(rssKb) && rssKb > 0) {
        processes.push({ pid, state: row.state, rss: rssKb * 1024, rssSource: "smaps_rollup", cpuTicks: row.cpuTicks });
        return;
      }
      rssOmissionReasons[match ? "zeroSmapsRollup" : "invalidSmapsRollup"]++;
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return;
      if (error.code !== "EACCES") throw error;
      rssOmissionReasons.missingSmapsRollup++;
    }
    rssOmissions++;
    rssOmissionReasons.missingVmRSS++;
    rssOmissionStates[row.state] = (rssOmissionStates[row.state] ?? 0) + 1;
  }));
  let pss = null, pssOmissions = 0;
  if (includePss) {
    let totalPss = 0;
    await Promise.all(processes.filter(row => row.state !== "Z").map(async row => {
      try {
        const rollup = await readFile(`/proc/${row.pid}/smaps_rollup`, "utf8");
        const match = rollup.match(/^Pss:\s+(\d+)\s+kB$/m);
        if (!match) { pssOmissions++; row.pssBytes = null; return; }
        row.pssBytes = Number(match[1]) * 1024;
        totalPss += row.pssBytes;
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes(error.code)) {
          // A process that exited before this read no longer contributes live
          // PSS; exclude it instead of counting a stale/missing sample as zero.
          row.pssBytes = null;
          return;
        }
        if (error.code !== "EACCES") throw error;
        pssOmissions++;
        row.pssBytes = null;
      }
    }));
    if (pssOmissions === 0) pss = totalPss;
  }
  return {
    processes, discoveryOmitted, rssOmissions, rssOmissionReasons, rssOmissionStates, pss, pssOmissions,
    omitted: rssOmissions,
    rss: processes.reduce((sum, row) => sum + row.rss, 0),
    cpuTicks: processes.reduce((sum, row) => sum + row.cpuTicks, 0),
  };
}

export async function fixtures() {
  const manifestPath = path.join(output, "fixtures/manifest.json");
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    await Promise.all(existing.map(item => readFile(path.join(output, "fixtures", item.name))));
    return existing;
  } catch { /* Generate only synthetic images, never discover user uploads. */ }
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const manifest = [];
  for (const [name, width, height, format, quality] of [
    ["detail.jpg", 3200, 2400, "jpeg", 73],
    ["phone-5mb.jpg", 4000, 3000, "jpeg", 82],
    ["phone-20mb.png", 2800, 2500, "png", null],
  ]) {
    const raw = Buffer.alloc(width * height * 3);
    let seed = 227;
    for (let i = 0; i < raw.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      raw[i] = seed & 255;
    }
    const pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
    const bytes = await (format === "jpeg" ? pipeline.jpeg({ quality }) : pipeline.png()).toBuffer();
    await writeFile(path.join(output, "fixtures", name), bytes);
    manifest.push({ name, width, height, bytes: bytes.length, format, quality, synthetic: true, seed: 227 });
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
