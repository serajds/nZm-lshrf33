import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { isolatedPostgres } from "./helpers/isolated-postgres.mjs";

const requireApi = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const XLSX = requireApi("xlsx");
const enabled = process.env.EXCEL_IMPORT_HTTP_TESTS === "1";
const start = "2026-01-01";
const end = "2026-01-31";
const activity = (name, from = start) => [name, from, end];

function workbook(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["اسم البند", "تاريخ البداية", "تاريخ النهاية"], ...rows,
  ]), "الأعمال");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }).toString("base64");
}

test("Excel preview → confirm → GET over authenticated HTTP and real PostgreSQL transactions", {
  skip: !enabled,
  timeout: 120_000,
}, async t => {
  const postgres = await isolatedPostgres();
  let server;
  let pool;
  try {
    // Import only AFTER replacing DATABASE_URL. No auth or transaction mocks.
    const [{ default: app }, schema, { hashPassword }, { eq }] = await Promise.all([
      import("../artifacts/api-server/src/app.ts"),
      import("../lib/db/src/index.ts"),
      import("../artifacts/api-server/src/lib/auth.ts"),
      import("../lib/db/node_modules/drizzle-orm/index.js"),
    ]);
    const { db, usersTable, companiesTable, userCompaniesTable, projectsTable,
      projectMembersTable, activityGroupsTable, activitiesTable, memberGroupAssignmentsTable } = schema;
    pool = schema.pool;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const password = randomUUID();
    const passwordHash = await hashPassword(password);
    const [company] = await db.insert(companiesTable).values({ name: "HTTP import fixtures", type: "owner" }).returning();

    async function request(url, token, body, expected = 200) {
      const response = await fetch(`${base}${url}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          // Exercise the application's edge-safe base64 JSON transport.
          ...(body === undefined ? {} : { "Content-Type": "text/plain" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, expected, `${url}: ${await response.clone().text()}`);
      return response.headers.get("content-type")?.includes("application/json")
        ? response.json() : { error: await response.text() };
    }

    async function fixture(names = ["A", "unrelated", "B"], role = "engineer", tab = "edit") {
      const [project] = await db.insert(projectsTable).values({
        name: `Excel fixture ${randomUUID()}`, location: "isolated",
        ownerEntity: "fixture", supervisorEntity: "fixture", contractor: "fixture", noSchedule: true,
      }).returning();
      const groups = names.length ? await db.insert(activityGroupsTable).values(names.map((name, sortOrder) => ({
        projectId: project.id, name, sortOrder,
      }))).returning() : [];
      const [user] = await db.insert(usersTable).values({
        phone: `fixture-${randomUUID()}`, fullName: "Fixture engineer", passwordHash, role,
      }).returning();
      await db.insert(userCompaniesTable).values({ userId: user.id, companyId: company.id });
      const [member] = await db.insert(projectMembersTable).values({
        userId: user.id, projectId: project.id, role, tabPermissions: { activities: tab },
      }).returning();
      const { token } = await request("/auth/login", null, { phone: user.phone, password });
      assert.equal(typeof token, "string");
      const url = `/projects/${project.id}`;
      return {
        project, groups, user, member, token, url,
        preview: (rows, mode = "detect", groupId, expected = 200) => request(
          `${url}/activities/import/preview`, token, { mode, groupId, fileBase64: workbook(rows) }, expected,
        ),
        confirm: (previewId, choices = {}, expected = 201, asToken = token) => request(
          `${url}/activities/import/confirm`, asToken, { previewId, choices }, expected,
        ),
        read: async () => ({
          groups: await request(`${url}/activity-groups`, token),
          activities: await request(`${url}/activities`, token),
        }),
      };
    }

    // Snapshot stored business rows (not sequences, which PostgreSQL does not
    // roll back). Includes audit and project side effects, not only HTTP views.
    async function snapshot(f) {
      const result = {};
      for (const table of ["activities", "activity_groups", "projects", "audit_log"]) {
        const key = table === "projects" ? "id" : "project_id";
        result[table] = (await pool.query(`SELECT * FROM ${table} WHERE ${key} = $1 ORDER BY id`, [f.project.id])).rows;
      }
      return result;
    }

    await t.test("file order survives reload, reused/new/repeated groups reorder only participating slots", async () => {
      const f = await fixture(["unrelated-first", "A", "unrelated-middle", "B", "unrelated-last"]);
      await db.insert(activitiesTable).values({
        projectId: f.project.id, groupId: f.groups[1].id, name: "pre-existing", sortOrder: 20,
      });
      const rows = [
        activity("ungrouped before"),
        ["B"], activity("Z first", "2026-01-20"), activity("A second"),
        ["New"], activity("new first"),
        ["A"], activity("A imported"),
        ["  New  "], activity("new repeated"),
      ];
      const p = await f.preview(rows);
      assert.deepEqual(p.rows.filter(r => r.kind === "activity").map(r => r.name),
        rows.filter(r => r.length === 3).map(r => r[0]));
      assert.equal(p.groups[0].matches[0].id, f.groups[3].id);
      const result = await f.confirm(p.previewId);
      assert.deepEqual([result.imported, result.groupsCreated, result.groupsUsed, result.rejected], [6, 1, 2, 0]);
      assert.deepEqual(result.warnings, []);
      const saved = await f.read();
      assert.deepEqual(saved.groups.map(g => g.name),
        ["unrelated-first", "B", "unrelated-middle", "New", "unrelated-last", "A"]);
      for (const index of [0, 2, 4]) {
        assert.equal(saved.groups[index].id, f.groups[index].id);
        assert.equal(saved.groups[index].sortOrder, f.groups[index].sortOrder);
      }
      assert.deepEqual(saved.activities.map(a => a.name),
        ["pre-existing", "ungrouped before", "Z first", "A second", "new first", "A imported", "new repeated"]);
      assert.equal(saved.activities.find(a => a.name === "ungrouped before").groupId, null);
      const expected = { B: ["Z first", "A second"], New: ["new first", "new repeated"], A: ["pre-existing", "A imported"] };
      for (const [name, names] of Object.entries(expected)) {
        const groupId = saved.groups.find(g => g.name === name).id;
        assert.deepEqual(saved.activities.filter(a => a.groupId === groupId).map(a => a.name), names);
      }
      assert.equal(new Set(saved.activities.map(a => a.sortOrder)).size, 7);
      assert.deepEqual(await f.read(), saved, "fresh GET must retain order");
      const beforeReplay = await snapshot(f);
      assert.deepEqual(await f.confirm(p.previewId), result, "consumed preview returns the committed result");
      assert.deepEqual(await snapshot(f), beforeReplay, "replay must not duplicate rows, groups or audit");
    });

    await t.test("existing target keeps group order and appends file sequence without inferring headings", async () => {
      const f = await fixture();
      const before = await f.read();
      const p = await f.preview([activity("Z", "2026-01-20"), ["not a valid activity"], activity("A")],
        "existing", f.groups[2].id);
      assert.deepEqual(p.groups, []);
      assert.deepEqual(p.counts, { activities: 2, rejected: 1 });
      const result = await f.confirm(p.previewId);
      assert.deepEqual([result.imported, result.groupsCreated, result.groupsUsed, result.rejected], [2, 0, 1, 1]);
      const saved = await f.read();
      assert.deepEqual(saved.groups, before.groups);
      assert.deepEqual(saved.activities.map(a => [a.name, a.groupId]), [["Z", f.groups[2].id], ["A", f.groups[2].id]]);
      const other = await fixture();
      await f.preview([activity("foreign")], "existing", other.groups[0].id, 400);
    });

    await t.test("normalized duplicate group names require explicit choice; new is distinct from reuse", async () => {
      const f = await fixture([" Work ", "unrelated", "work"]);
      const p = await f.preview([["WORK"], activity("chosen")]);
      assert.deepEqual(p.groups[0].matches.map(g => g.id), [f.groups[0].id, f.groups[2].id]);
      const before = await snapshot(f);
      await f.confirm(p.previewId, {}, 400);
      await f.confirm(p.previewId, { 2: { action: "existing", groupId: f.groups[1].id } }, 400);
      assert.deepEqual(await snapshot(f), before);
      await f.confirm(p.previewId, { 2: { action: "existing", groupId: f.groups[2].id } });
      assert.equal((await f.read()).activities[0].groupId, f.groups[2].id);
      const newPreview = await f.preview([["WORK"], activity("new chosen")]);
      const result = await f.confirm(newPreview.previewId, { 2: { action: "new" } });
      assert.equal(result.groupsCreated, 1);
      const saved = await f.read();
      const newActivity = saved.activities.find(a => a.name === "new chosen");
      assert.ok(!f.groups.some(g => g.id === newActivity.groupId));
      assert.equal(saved.groups.length, 4);
    });

    await t.test("database failure rolls back newly created groups, reorder, activities and audit; same preview can retry", async () => {
      const f = await fixture();
      const p = await f.preview([["B"], activity("first"), ["new rollback"], activity("fail insert"), ["A"], activity("last")]);
      const before = await snapshot(f);
      // Real PostgreSQL exception after group creation/reordering and after an
      // earlier activity row was inserted. No mocked db/transaction adapter.
      await pool.query(`
        CREATE SEQUENCE fixture_rollback_reached;
        CREATE FUNCTION fixture_fail_import() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.name = 'fail insert' THEN
            IF NOT EXISTS (SELECT 1 FROM activities WHERE project_id = NEW.project_id AND name = 'first')
              OR NOT EXISTS (SELECT 1 FROM activity_groups WHERE project_id = NEW.project_id AND name = 'new rollback')
              OR NOT EXISTS (SELECT 1 FROM activity_groups WHERE project_id = NEW.project_id AND name = 'B' AND sort_order = 0)
            THEN RAISE EXCEPTION 'fixture did not reach partial writes'; END IF;
            PERFORM nextval('fixture_rollback_reached');
            RAISE EXCEPTION 'fixture forced import rollback';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER fixture_fail_import AFTER INSERT ON activities
          FOR EACH ROW EXECUTE FUNCTION fixture_fail_import();
      `);
      try {
        await f.confirm(p.previewId, {}, 500);
        // Sequence advances are deliberately nontransactional, proving the
        // injected exception happened AFTER all partial-write preconditions.
        assert.equal((await pool.query("SELECT is_called FROM fixture_rollback_reached")).rows[0].is_called, true);
        assert.deepEqual(await snapshot(f), before, "entire transaction must roll back");
        assert.deepEqual((await f.read()).groups.map(g => g.id), f.groups.map(g => g.id));
        assert.deepEqual((await f.read()).activities, []);
      } finally {
        await pool.query("DROP TRIGGER fixture_fail_import ON activities; DROP FUNCTION fixture_fail_import(); DROP SEQUENCE fixture_rollback_reached");
      }
      const result = await f.confirm(p.previewId);
      assert.deepEqual([result.imported, result.groupsCreated], [3, 1]);
      assert.deepEqual((await f.read()).groups.map(g => g.name), ["B", "unrelated", "new rollback", "A"]);
    });

    await t.test("assigned engineers can import only into permitted groups; denials never write", async () => {
      const f = await fixture();
      await db.insert(memberGroupAssignmentsTable).values({ memberId: f.member.id, groupId: f.groups[0].id });
      const cases = [
        { rows: [activity("outside")], mode: "none" },
        { rows: [activity("outside")], mode: "existing", groupId: f.groups[2].id },
        { rows: [["B"], activity("outside")] },
        { rows: [["new forbidden"], activity("outside")] },
        { rows: [activity("ungrouped"), ["A"], activity("inside")] },
        { rows: [["A"], activity("outside")], choices: { 2: { action: "new" } } },
      ];
      for (const c of cases) {
        const p = await f.preview(c.rows, c.mode ?? "detect", c.groupId);
        const before = await snapshot(f);
        await f.confirm(p.previewId, c.choices, 403);
        assert.deepEqual(await snapshot(f), before);
      }
      for (const [mode, rows, groupId] of [
        ["existing", [activity("allowed existing")], f.groups[0].id],
        ["detect", [["A"], activity("allowed detected")]],
      ]) {
        const p = await f.preview(rows, mode, groupId);
        await f.confirm(p.previewId);
      }
      assert.ok((await f.read()).activities.every(a => a.groupId === f.groups[0].id));
      // Permission changes between preview and confirm must be checked afresh.
      const p = await f.preview([activity("revoked")], "existing", f.groups[0].id);
      await db.update(memberGroupAssignmentsTable).set({ groupId: f.groups[2].id })
        .where(eq(memberGroupAssignmentsTable.memberId, f.member.id));
      const before = await snapshot(f);
      await f.confirm(p.previewId, {}, 403);
      assert.deepEqual(await snapshot(f), before);
    });

    await t.test("authentication, project membership and activities edit permission protect both POST routes", async () => {
      const f = await fixture();
      const p = await f.preview([activity("protected")], "none");
      const outsider = await fixture();
      const readonly = await fixture(["A"], "engineer", "view");
      const contractor = await fixture(["A"], "contractor");
      for (const [url, token, expected] of [
        [f.url, null, 401], [f.url, "invalid-token", 401],
        [f.url, outsider.token, 403], [readonly.url, readonly.token, 403],
        [contractor.url, contractor.token, 403],
      ]) {
        const before = await snapshot(f);
        await request(`${url}/activities/import/preview`, token, { mode: "none", fileBase64: workbook([activity("protected")]) }, expected);
        await request(`${url}/activities/import/confirm`, token, { previewId: p.previewId }, expected);
        assert.deepEqual(await snapshot(f), before);
      }
    });

    await t.test("preview identity, expiry, missing ID, renamed/deleted targets and changed matches fail closed", async () => {
      const f = await fixture();
      const other = await fixture();
      const p = await f.preview([activity("private preview")], "none");
      // Give the other legitimate user project access: rejection must be the
      // preview owner check, not the project-membership middleware.
      await db.insert(projectMembersTable).values({
        userId: other.user.id, projectId: f.project.id, role: "engineer", tabPermissions: { activities: "edit" },
      });
      const before = await snapshot(f);
      await f.confirm(p.previewId, {}, 409, other.token);
      await other.confirm(p.previewId, {}, 409);
      await f.confirm(randomUUID(), {}, 409);
      assert.deepEqual(await snapshot(f), before);
      const realNow = Date.now;
      try {
        // The only fake is the clock; HTTP, JWT checks and DB remain real.
        Date.now = () => realNow() + 16 * 60_000;
        await f.confirm(p.previewId, {}, 409);
      } finally {
        Date.now = realNow;
      }
      assert.deepEqual(await snapshot(f), before);

      for (const mutation of ["rename-existing", "delete-existing", "rename-detected", "delete-detected", "new-match"]) {
        const s = await fixture();
        const existing = mutation.endsWith("existing");
        const preview = await s.preview(existing ? [activity("stale")] : [["A"], activity("stale")],
          existing ? "existing" : "detect", existing ? s.groups[0].id : undefined);
        if (mutation.startsWith("rename")) {
          await db.update(activityGroupsTable).set({ name: "renamed" }).where(eq(activityGroupsTable.id, s.groups[0].id));
        } else if (mutation.startsWith("delete")) {
          await db.delete(activityGroupsTable).where(eq(activityGroupsTable.id, s.groups[0].id));
        } else {
          await db.insert(activityGroupsTable).values({ projectId: s.project.id, name: " a ", sortOrder: 3 });
        }
        const afterMutation = await snapshot(s);
        const choices = mutation.endsWith("detected") ? { 2: { action: "existing", groupId: s.groups[0].id } } : {};
        await s.confirm(preview.previewId, choices, 409);
        assert.deepEqual(await snapshot(s), afterMutation, mutation);
      }
    });
  } finally {
    try {
      if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      try {
        if (pool) await pool.end();
      } finally {
        await postgres.stop();
      }
    }
  }
});
