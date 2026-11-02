// Entire cluster is disposable; never touches the configured project database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";
const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));

test("portfolio permissions, concurrency, privacy, JSON and native backup roundtrip", { timeout: 180000 }, async () => {
  const isolated = await isolatedPostgres();
  let pool, server;
  try {
    const s = await import("../lib/db/src/index.ts");
    pool = s.pool;
    const { db, projectsTable, usersTable, projectMembersTable, projectCategoriesTable } = s;
    const { eq } = await import("../lib/db/node_modules/drizzle-orm/index.js");
    await pool.query(await readFile("lib/db/migrations/0010_project_portfolio.sql", "utf8"));
    const { signToken } = await import("../artifacts/api-server/src/lib/auth.ts");
    const projectsRouter = (await import("../artifacts/api-server/src/routes/projects.ts")).default;
    const categoriesRouter = (await import("../artifacts/api-server/src/routes/project-categories.ts")).default;
    const { validatePortfolioSnapshot, restorePortfolioSnapshot } = await import("../artifacts/api-server/src/lib/portfolio-backup.ts");
    const express = requireApi("express");
    const app = express();
    app.use(express.json(), projectsRouter, categoriesRouter);
    app.use((e, _req, res, _next) => { console.error(e); res.status(500).json({ error: "test failure" }); });
    server = app.listen(0, "127.0.0.1");
    await new Promise(r => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const accounts = await db.insert(usersTable).values(["admin", "engineer", "engineer", "contractor"].map((role, n) => ({
      phone: `portfolio-fixture-${n}`, fullName: "fixture", passwordHash: "unused", role,
    }))).returning();
    const tokens = accounts.map(u => signToken({ userId: u.id, phone: u.phone, role: u.role }));
    async function api(method, route, body, who = 0) {
      const r = await fetch(`${base}${route}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    }
    const projectBody = name => ({ name, location: "fixture", ownerEntity: "owner", contractor: "contractor", supervisorEntity: "supervisor", noSchedule: true });
    const create = async (name, fields = {}) => {
      const r = await api("POST", "/projects", { ...projectBody(name), ...fields });
      assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
    };
    const main = await create("private main");
    const child = await create("visible child", { parentProjectId: main.id });
    const standalone = await create("standalone");
    const other = await create("other");
    assert.equal(standalone.parentProjectId, null);
    assert.equal(standalone.categoryId, null);
    await db.insert(projectMembersTable).values([
      { projectId: child.id, userId: accounts[1].id, role: "project_manager" },
      { projectId: main.id, userId: accounts[2].id, role: "engineer" },
      { projectId: child.id, userId: accounts[3].id, role: "project_manager" },
    ]);
    const before = await db.select().from(projectsTable).where(eq(projectsTable.id, child.id));
    const category = await api("POST", "/project-categories", { name: "أعمال المباني" });
    assert.equal(category.status, 201);
    assert.equal((await api("POST", "/project-categories", { name: "أعمال المباني" })).status, 409);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { categoryId: category.body.id }, 1)).status, 200);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { parentProjectId: other.id }, 1)).status, 403);
    assert.equal((await api("POST", "/project-categories", { name: "forbidden" }, 1)).status, 403);
    assert.equal((await api("DELETE", `/projects/${child.id}`, undefined, 1)).status, 403);
    assert.equal((await api("POST", "/projects", projectBody("forbidden"), 1)).status, 403);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { categoryId: null }, 3)).status, 403);
    const visible = await api("GET", "/projects", undefined, 1);
    assert.equal(visible.body.length, 1);
    assert.equal(visible.body[0].parentProjectId, null);
    assert.equal(visible.body[0].portfolioRelation, "child");
    assert.equal(visible.body[0].canManage, true);
    assert.equal(JSON.stringify(visible.body).includes("private main"), false);
    for (const key of ["linkCode", "ownerAccessPassword", "ownerAccessToken", "summaryWidgets"]) assert.equal(key in visible.body[0], false);
    assert.equal((await api("GET", `/projects/${child.id}`, undefined, 1)).body.parentProjectId, null);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { name: child.name }, 1)).body.parentProjectId, null);
    assert.deepEqual((await api("GET", "/project-categories", undefined, 2)).body, []);
    const onlyMain = (await api("GET", "/projects", undefined, 2)).body;
    assert.equal(onlyMain.length, 1);
    assert.equal(onlyMain[0].portfolioRelation, "independent", "no hidden child count/relation leaked");
    assert.equal((await api("GET", `/projects/${child.id}`, undefined, 2)).status, 403);
    assert.equal((await api("DELETE", `/projects/${main.id}`)).status, 409);
    assert.equal((await api("PATCH", `/projects/${main.id}`, { parentProjectId: child.id })).status, 409);
    assert.equal((await api("PATCH", `/projects/${other.id}`, { parentProjectId: child.id })).status, 409);
    assert.equal((await api("PATCH", `/projects/${other.id}`, { parentProjectId: other.id })).status, 409);
    assert.equal((await api("PATCH", `/projects/${other.id}`, { parentProjectId: 2147483600 })).status, 409);
    assert.equal((await api("PATCH", `/projects/${other.id}`, { categoryId: 0 })).status, 400);
    assert.equal((await api("PATCH", `/projects/${other.id}`, { categoryId: 2147483600 })).status, 400);
    const races = await Promise.all([
      api("PATCH", `/projects/${standalone.id}`, { parentProjectId: other.id }),
      api("PATCH", `/projects/${other.id}`, { parentProjectId: standalone.id }),
    ]);
    assert.deepEqual(races.map(r => r.status).sort(), [200, 409], "concurrent opposite edges cannot both commit");
    await api("PATCH", `/projects/${standalone.id}`, { parentProjectId: null });
    await api("PATCH", `/projects/${other.id}`, { parentProjectId: null });
    // The database guard also covers direct/import writers, not just our routes.
    const directRace = await Promise.allSettled([
      pool.query("UPDATE projects SET parent_project_id=$1 WHERE id=$2", [other.id, standalone.id]),
      pool.query("UPDATE projects SET parent_project_id=$1 WHERE id=$2", [standalone.id, other.id]),
    ]);
    assert.equal(directRace.filter(r => r.status === "fulfilled").length, 1);
    await api("PATCH", `/projects/${standalone.id}`, { parentProjectId: null });
    await api("PATCH", `/projects/${other.id}`, { parentProjectId: null });
    const depthRace = await Promise.all([
      api("PATCH", `/projects/${standalone.id}`, { parentProjectId: child.id }),
      api("PATCH", `/projects/${child.id}`, { parentProjectId: other.id }),
    ]);
    assert.equal(depthRace[0].status, 409);
    assert.equal(depthRace[1].status, 200);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { parentProjectId: main.id })).status, 200);
    const search = (await api("GET", "/projects?search=visible")).body;
    assert.equal(search.length, 1); assert.equal(search[0].parentProjectId, main.id);
    assert.equal((await api("PATCH", `/project-categories/${category.body.id}`, { name: "تصنيف جديد" })).status, 200);
    const snapshot = {
      projects: await db.select().from(projectsTable),
      projectCategories: await db.select().from(projectCategoriesTable),
    };
    validatePortfolioSnapshot(snapshot);
    for (const projects of [
      [{ id: 1, parentProjectId: 1 }],
      [{ id: 1, parentProjectId: 2 }, { id: 2, parentProjectId: 1 }],
      [{ id: 1 }, { id: 2, parentProjectId: 1 }, { id: 3, parentProjectId: 2 }],
      [{ id: 1, parentProjectId: 99 }],
      [{ id: 1, categoryId: 99 }],
    ]) assert.throws(() => validatePortfolioSnapshot({ projects }));
    assert.doesNotThrow(() => validatePortfolioSnapshot({ projects: [{ id: 1 }] }));
    const map = new Map(snapshot.projects.map(p => [p.id, p.id]));
    await db.transaction(tx => restorePortfolioSnapshot(tx, JSON.parse(JSON.stringify(snapshot)), map));
    assert.equal((await api("GET", `/projects/${child.id}`)).body.parentProjectId, main.id);
    assert.equal((await api("GET", `/projects/${child.id}`)).body.categoryId, category.body.id);
    await assert.rejects(db.transaction(tx => restorePortfolioSnapshot(tx, { projects: [{ id: child.id, parentProjectId: child.id }] }, map)));
    assert.equal((await api("GET", `/projects/${child.id}`)).body.parentProjectId, main.id, "invalid import must leave existing data untouched");
    await db.transaction(tx => restorePortfolioSnapshot(tx, { projects: [{ id: standalone.id }] }, new Map([[standalone.id, standalone.id]])));
    assert.equal((await api("GET", `/projects/${standalone.id}`)).body.categoryId, null);
    // Existing native backup format includes tables, foreign keys and trigger.
    const dump = execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--dbname", process.env.DATABASE_URL]);
    execFileSync("createdb", ["--maintenance-db", process.env.DATABASE_URL, "portfolio_restore"]);
    const restoredUrl = process.env.DATABASE_URL.replace("/postgres?", "/portfolio_restore?");
    execFileSync("pg_restore", ["--no-owner", "--no-acl", "--dbname", restoredUrl], { input: dump });
    const pgClient = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
    const restored = new pgClient.Client({ connectionString: restoredUrl });
    await restored.connect();
    const restoredChild = (await restored.query("SELECT parent_project_id,category_id FROM projects WHERE id=$1", [child.id])).rows[0];
    assert.equal(restoredChild.parent_project_id, main.id);
    assert.equal(restoredChild.category_id, category.body.id);
    await assert.rejects(restored.query("UPDATE projects SET parent_project_id=id WHERE id=$1", [other.id]));
    await restored.end();
    assert.equal((await api("DELETE", `/project-categories/${category.body.id}`)).status, 204);
    assert.equal((await api("GET", `/projects/${child.id}`)).body.categoryId, null);
    assert.equal((await api("PATCH", `/projects/${child.id}`, { parentProjectId: null })).status, 200);
    assert.equal((await api("DELETE", `/projects/${main.id}`)).status, 204);
    assert.equal((await api("GET", `/projects/${child.id}`)).status, 200);
    const [after] = await db.select().from(projectsTable).where(eq(projectsTable.id, child.id));
    for (const key of ["overallProgress", "startDate", "expectedEndDate", "noSchedule"]) assert.equal(after[key], before[0][key]);
    console.log("PASS isolated portfolio: access, hidden-parent scrubbing, catalog, two-level races, protected delete, legacy/JSON/native restore; no real project changes");
  } finally {
    if (server) await new Promise(r => server.close(r));
    if (pool) await pool.end();
    await isolated.stop();
  }
});
