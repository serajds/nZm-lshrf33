import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const enabled = process.env.PERFORMANCE_HTTP_TESTS === "1";
const results = [];

// Optional exact source baseline, executed against the SAME isolated database
// and instrumented pg pool. No exported data, deployment writes or fake DB.
async function baselineRouter(ref) {
  const filename = "artifacts/api-server/src/routes/activities.ts";
  const { transpileModule, ModuleKind, ScriptTarget } = await import("typescript");
  let source = execFileSync("git", ["show", `${ref}:${filename}`], { encoding: "utf8" });
  const resolve = spec => {
    if (spec.startsWith("node:")) return spec;
    if (spec.startsWith(".")) {
      const filename = path.resolve("artifacts/api-server/src/routes", spec);
      return pathToFileURL(existsSync(filename) ? filename : `${filename}.ts`).href;
    }
    return pathToFileURL(requireApi.resolve(spec)).href;
  };
  source = source.replace(/from\s+["']([^"']+)["']/g, (_match, spec) => `from "${resolve(spec)}"`)
    .replace(/import\(["']([^"']+)["']\)/g, (_match, spec) => `import("${resolve(spec)}")`);
  const file = path.resolve("generated-artifacts/performance-baseline.mjs");
  await writeFile(file, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText);
  try { return (await import(pathToFileURL(file).href)).default; }
  finally { await rm(file, { force: true }); }
}

test("measured activities, source sharing, reorder isolation, report payload and pool idle recovery", {
  skip: !enabled, timeout: 180000,
}, async t => {
  const pg = await isolatedPostgres();
  const servers = [];
  let pool;
  try {
    const schema = await import("../lib/db/src/index.ts");
    const { signToken } = await import("../artifacts/api-server/src/lib/auth.ts");
    const { eq } = await import("../lib/db/node_modules/drizzle-orm/index.js");
    const express = requireApi("express");
    const compression = requireApi("compression");
    const current = (await import("../artifacts/api-server/src/routes/activities.ts")).default;
    const reports = (await import("../artifacts/api-server/src/routes/reports.ts")).default;
    const dashboard = (await import("../artifacts/api-server/src/routes/dashboard.ts")).default;
    const { db, usersTable, projectsTable, activitiesTable, activityGroupsTable, reportsTable,
      requestMetrics, newRequestMetrics } = schema;
    pool = schema.pool;
    const [admin, reader] = await db.insert(usersTable).values([
      { phone: "fixture-perf-admin", fullName: "Fixture", role: "admin", passwordHash: "unused" },
      { phone: "fixture-perf-reader", fullName: "Fixture", role: "engineer", passwordHash: "unused" },
    ]).returning();
    const token = signToken({ userId: admin.id, phone: admin.phone, role: admin.role });
    const readerToken = signToken({ userId: reader.id, phone: reader.phone, role: reader.role });
    const projects = await db.insert(projectsTable).values(["source", "target"].map(name => ({
      name, location: "isolated", ownerEntity: "fixture", supervisorEntity: "fixture", contractor: "fixture",
      startDate: "2026-01-01", expectedEndDate: "2026-12-31",
    }))).returning();
    const [source, target] = projects;
    await db.insert(schema.projectMembersTable).values({ projectId: target.id, userId: reader.id, role: "engineer" });
    const groups = await db.insert(activityGroupsTable).values([
      { projectId: source.id, name: "source group", linkCode: "fixture-private-code" },
      ...Array.from({ length: 100 }, (_, index) => ({ projectId: target.id, name: `target ${index}`, sortOrder: index })),
    ]).returning();
    const sourceGroup = groups[0];
    await db.insert(activitiesTable).values({
      projectId: source.id, groupId: sourceGroup.id, name: "source child", actualProgress: 30,
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31",
    });
    const rows = await db.insert(activitiesTable).values(Array.from({ length: 100 }, (_, index) => ({
      projectId: target.id, groupId: groups[1 + index].id, name: `linked ${index}`,
      externalSourceGroupId: sourceGroup.id, actualProgress: 30, sortOrder: index,
      plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31",
    }))).returning();
    const snapshot = rows.map(row => ({ id: row.id, name: row.name, actualProgress: 30, detail: "fixture ".repeat(40) }));
    const [report] = await db.insert(reportsTable).values({
      projectId: target.id, type: "weekly", reportNumber: 1, reportDate: "2026-11-02",
      periodStart: "2026-10-26", periodEnd: "2026-11-02",
      workDescription: "fixture", progressPercentage: 30, activitiesSnapshot: snapshot,
    }).returning();

    async function serve(router) {
      const app = express();
      const observations = [];
      app.use((_req, res, next) => {
        const metrics = newRequestMetrics();
        const began = performance.now();
        res.on("finish", () => observations.push({ ...metrics, serverMs: performance.now() - began }));
        requestMetrics.run(metrics, next);
      });
      app.use(compression({ threshold: 1024 }));
      app.use(express.json());
      app.use("/api", router, reports, dashboard);
      const server = app.listen(0, "127.0.0.1");
      servers.push(server);
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      return async (url, body, asToken = token) => {
        const began = performance.now();
        const response = await new Promise((resolve, reject) => {
          const req = http.request(`${base}/api${url}`, {
            method: body ? "PUT" : "GET",
            headers: { Authorization: `Bearer ${asToken}`, "Accept-Encoding": "gzip", "Content-Type": "application/json" },
          }, res => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => {
              const bytes = Buffer.concat(chunks);
              const raw = res.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes;
              resolve({ status: res.statusCode, encoding: res.headers["content-encoding"], wireBytes: bytes.length,
                rawBytes: raw.length, data: JSON.parse(raw.toString()) });
            });
          });
          req.on("error", reject);
          req.end(body ? JSON.stringify(body) : undefined);
        });
        const metrics = observations.at(-1);
        return { ...response, ...metrics, totalMs: performance.now() - began };
      };
    }
    const request = await serve(current);
    const before = process.env.PERF_BASELINE_REF ? await serve(await baselineRouter(process.env.PERF_BASELINE_REF)) : null;
    const url = `/projects/${target.id}`;
    const summarize = item => {
      const { data, ...stats } = item;
      return stats;
    };
    for (const [label, run] of [["before", before], ["after", request]]) {
      if (!run) continue;
      const list = await run(`${url}/activities`);
      assert.equal(list.status, 200);
      assert.equal(list.data.length, 100);
      assert.ok(list.data.every(row => row.actualProgress === 30 && row.externalSource.available));
      if (label === "after") assert.ok(list.queries < 20, `shared source reads: ${list.queries}`);
      results.push({ label, operation: "list-100-shared-source", ...summarize(list) });
      const order = { items: [...rows].reverse().map((row, sortOrder) => ({ id: row.id, sortOrder })) };
      const samples = [];
      for (let i = 0; i < 5; i++) {
        samples.push(await run(`${url}/activities/reorder`, order));
        assert.equal(samples.at(-1).status, 200);
      }
      results.push(...samples.map((sample, index) => ({ label, operation: "reorder-100-100-groups", sample: index, ...summarize(sample) })));
    }
    await t.test("order and source values stay correct; stale claims never expose private sources", async () => {
      const list = await request(`${url}/activities`);
      assert.deepEqual(list.data.map(row => row.id), [...rows].reverse().map(row => row.id));
      assert.ok(list.data.every(row => row.actualProgress === 30 && row.groupId === rows.find(prior => prior.id === row.id).groupId));
      const denied = await request(`/projects/${source.id}/activities`, undefined, readerToken);
      assert.equal(denied.status, 403);
      const redacted = await request(`${url}/activities`, undefined, readerToken);
      assert.equal(redacted.status, 200);
      assert.ok(redacted.queries < 25);
      assert.ok(redacted.data.every(row => !("externalSourceGroupId" in row) && !("linkCode" in row.externalSource)));
      // Concurrent operations are serialized, and the final request wins.
      const ascending = { items: rows.map((row, sortOrder) => ({ id: row.id, sortOrder })) };
      const reversed = { items: [...rows].reverse().map((row, sortOrder) => ({ id: row.id, sortOrder })) };
      assert.ok((await Promise.all([request(`${url}/activities/reorder`, ascending), request(`${url}/activities/reorder`, reversed)]))
        .every(response => response.status === 200));
      assert.deepEqual((await request(`${url}/activities`)).data.map(row => row.id), [...rows].reverse().map(row => row.id));
      const invalid = await request(`${url}/activities/reorder`, { items: [{ id: rows[0].id, sortOrder: 0, groupId: sourceGroup.id }] });
      assert.equal(invalid.status, 400);
      assert.ok((await db.select().from(schema.auditLogTable).where(eq(schema.auditLogTable.projectId, target.id))).length >= 7);
    });
    await t.test("report list excludes snapshot, detail retains it; real gzip transport", async () => {
      const list = await request(`${url}/reports`);
      const detail = await request(`${url}/reports/${report.id}`);
      assert.equal(list.status, 200);
      assert.equal(detail.status, 200);
      assert.equal("activitiesSnapshot" in list.data[0], false);
      assert.deepEqual(detail.data.activitiesSnapshot, snapshot);
      assert.equal(detail.encoding, "gzip");
      results.push({ label: "after", operation: "report-list", ...summarize(list) },
        { label: "after", operation: "report-detail", ...summarize(detail) });
    });
    await t.test("shared descendants, multiple sources and corrupt sibling cycles settle without cross-user caches", async () => {
      const nested = await db.insert(activityGroupsTable).values(["A", "B", "C"].map(name => ({
        projectId: source.id, name: `nested ${name}`,
      }))).returning();
      // A → B,C and B ↔ C: deliberately corrupt fixture only. Concurrent
      // sibling promise memoization must not deadlock on these dependencies.
      await db.insert(activitiesTable).values([
        { groupId: nested[0].id, externalSourceGroupId: nested[1].id },
        { groupId: nested[0].id, externalSourceGroupId: nested[2].id },
        { groupId: nested[1].id, externalSourceGroupId: nested[2].id },
        { groupId: nested[2].id, externalSourceGroupId: nested[1].id },
      ].map((row, index) => ({ ...row, projectId: source.id, name: `cycle fixture ${index}`, actualProgress: 20 })));
      await db.insert(activitiesTable).values({
        projectId: target.id, name: "cyclic source fixture", externalSourceGroupId: nested[0].id,
      });
      const response = await Promise.race([
        request(`${url}/activities`),
        new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new Error("cycle deadlock")), 5000); timer.unref(); }),
      ]);
      assert.equal(response.status, 200);
      assert.ok(response.queries < 35);
      assert.equal(response.data.length, 101);
      // Explicitly change source on the fixture DB. A subsequent request must
      // see new values, proving this is request-local, not a shared global cache.
      await db.update(activitiesTable).set({ actualProgress: 60 }).where(eq(activitiesTable.groupId, sourceGroup.id));
      const updated = await request(`${url}/activities`);
      assert.ok(updated.data.filter(row => row.externalSourceGroupId === sourceGroup.id).every(row => row.actualProgress === 60));
    });
    await t.test("many distinct imported groups resolve with bounded query count", async () => {
      const manyGroups = await db.insert(activityGroupsTable).values(
        Array.from({ length: 60 }, (_, index) => ({
          projectId: source.id, name: `batch source ${index}`, sortOrder: index,
        })),
      ).returning();
      await db.insert(activitiesTable).values(manyGroups.map((group, index) => ({
        projectId: source.id, groupId: group.id, name: `batch child ${index}`,
        actualProgress: 40, plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31",
      })));
      const [manyTarget] = await db.insert(projectsTable).values({
        name: "many linked groups target", location: "isolated", ownerEntity: "fixture",
        supervisorEntity: "fixture", contractor: "fixture",
        startDate: "2026-01-01", expectedEndDate: "2026-12-31",
      }).returning();
      await db.insert(activitiesTable).values(manyGroups.map((group, index) => ({
        projectId: manyTarget.id, name: `batch linked ${index}`,
        externalSourceGroupId: group.id, actualProgress: 1, sortOrder: index,
      })));

      const list = await request(`/projects/${manyTarget.id}/activities`);
      assert.equal(list.status, 200);
      assert.equal(list.data.length, 60);
      assert.ok(list.data.every(row => row.actualProgress === 40 && row.externalSource.available));
      assert.ok(list.queries < 20, `distinct source groups required ${list.queries} queries`);
      results.push({ label: "after", operation: "list-60-distinct-source-groups",
        queries: list.queries, queryMs: list.queryMs, poolWaitMs: list.poolWaitMs, totalMs: list.totalMs });

      const summary = await request(`/projects/${manyTarget.id}/summary`);
      assert.equal(summary.status, 200);
      assert.equal(summary.data.activitiesTotal, 60);
      assert.equal(summary.data.overallProgress, 40);
      assert.ok(summary.queries < 25, `linked project summary required ${summary.queries} queries`);
      results.push({ label: "after", operation: "summary-60-distinct-source-groups",
        queries: summary.queries, queryMs: summary.queryMs, poolWaitMs: summary.poolWaitMs, totalMs: summary.totalMs });

      const dashboardSummary = await request("/dashboard/summary");
      assert.equal(dashboardSummary.status, 200);
      assert.ok(dashboardSummary.queries < 35, `dashboard linked progress required ${dashboardSummary.queries} queries`);
      results.push({ label: "after", operation: "dashboard-summary-linked-projects",
        queries: dashboardSummary.queries, queryMs: dashboardSummary.queryMs,
        poolWaitMs: dashboardSummary.poolWaitMs, totalMs: dashboardSummary.totalMs });
    });
    await t.test("all idle connections expire and the next query reconnects", async () => {
      await new Promise(resolve => setTimeout(resolve, 21000));
      assert.equal(pool.totalCount, 0);
      assert.equal((await pool.query("select 1 as ok")).rows[0].ok, 1);
      assert.equal(pool.options.min, 0);
      assert.equal(pool.options.idleTimeoutMillis, 20000);
      assert.equal(pool.options.allowExitOnIdle, true);
    });
    await mkdir("generated-artifacts", { recursive: true });
    await writeFile("generated-artifacts/performance-http.json", JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (pool) await pool.end();
    await pg.stop();
  }
});
