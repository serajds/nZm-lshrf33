import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { PgDialect } from "drizzle-orm/pg-core";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/routes/project-activity-reminder.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm", packages: "external",
  plugins: [{
    name: "reminder-fixtures",
    setup(builder) {
      builder.onResolve({ filter: /^drizzle-orm(?:\/.*)?$/ }, args => ({ path: args.path, external: true }));
      builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
      builder.onResolve({ filter: /middlewares\/auth$/ }, () => ({ path: "auth", namespace: "fixture" }));
      builder.onResolve({ filter: /lib\/audit$/ }, () => ({ path: "audit", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "auth"
          ? `export const requireProjectManager = () => function managerOnly() {};
             export const requireProjectAccess = () => function projectAccess() {};`
          : path === "audit"
            ? `export const logAudit = async event => globalThis.reminderAuditEvents.push(event);`
            : `import {pgTable, integer, boolean} from "drizzle-orm/pg-core";
               export const projectMembersTable = pgTable("project_members", {
                 id: integer("id"), projectId: integer("project_id"),
                 activityReminderEnabled: boolean("activity_reminder_enabled")
               });
               export const db = {
                 update: (...args) => globalThis.reminderDb.update(...args),
                 execute: (...args) => globalThis.reminderDb.execute(...args)
               };`,
      }));
    },
  }],
});
const dir = await mkdtemp(new URL("../node_modules/.reminder-test-", import.meta.url));
let router;
try {
  await writeFile(`${dir}/route.mjs`, compiled.outputFiles[0].text);
  router = (await import(`${dir}/route.mjs`)).default;
} finally { await rm(dir, { recursive: true, force: true }); }
const setting = router.stack.find(layer => layer.route?.methods.put).route;
const claim = router.stack.find(layer => layer.route?.methods.post).route;
const dialect = new PgDialect();
function response() {
  return {
    code: 200, headers: {},
    status(code) { this.code = code; return this; },
    setHeader(key, value) { this.headers[key] = value; },
    json(body) { this.body = body; return this; },
  };
}
async function invoke(route, overrides = {}) {
  const res = response();
  await route.stack.at(-1).handle({
    params: { projectId: "2", id: "7" }, user: { userId: 10 },
    body: { enabled: true }, ...overrides,
  }, res);
  return res;
}

test("settings are manager-only; claims require project access", () => {
  assert.equal(setting.stack[0].handle.name, "managerOnly");
  assert.equal(claim.stack[0].handle.name, "projectAccess");
});
test("invalid settings cannot reach the database", async () => {
  globalThis.reminderDb = { update() { assert.fail("Unexpected DB write"); } };
  for (const overrides of [
    { body: { enabled: "true" } }, { body: {} }, { body: { enabled: 1 } },
    { params: { projectId: "2junk", id: "7" } }, { params: { projectId: "2", id: "-1" } },
  ]) assert.equal((await invoke(setting, overrides)).code, 400);
});
test("enabling/disabling scopes writes to the member AND project, without changing roles or daily history", async () => {
  for (const enabled of [true, false]) {
    globalThis.reminderAuditEvents = [];
    globalThis.reminderDb = {
      update() {
        return { set(values) {
          assert.deepEqual(values, { activityReminderEnabled: enabled });
          return { where(condition) {
            assert.deepEqual(dialect.sqlToQuery(condition).params, [7, 2]);
            return { returning: async () => [{ id: 7, enabled }] };
          } };
        } };
      },
    };
    const res = await invoke(setting, { body: { enabled } });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { id: 7, enabled });
    assert.equal(globalThis.reminderAuditEvents[0].projectId, 2);
  }
});
test("non-member or wrong-project targets return 404 without an audit entry", async () => {
  globalThis.reminderAuditEvents = [];
  globalThis.reminderDb = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  assert.equal((await invoke(setting)).code, 404);
  assert.equal(globalThis.reminderAuditEvents.length, 0);
});
test("claim uses authenticated identity, Libya day, atomic daily guard and only the member's own project activity edits", async () => {
  globalThis.reminderDb = {
    execute: async query => {
      const compiled = dialect.sqlToQuery(query);
      assert.deepEqual(compiled.params, [2, 10, 2]);
      assert.match(compiled.sql, /WITH claimed AS/);
      assert.match(compiled.sql, /activity_reminder_enabled = true/);
      assert.match(compiled.sql, /IS DISTINCT FROM.*Africa\/Tripoli/);
      assert.match(compiled.sql, /a\.project_id = \$3 AND a\.user_id = c\.user_id/);
      assert.match(compiled.sql, /max\(a\.created_at\)/);
      assert.match(compiled.sql, /a\.entity_type = 'activity'/);
      assert.doesNotMatch(compiled.sql, /a\.entity_type = 'report'/);
      return { rows: [{ fullName: "عضو اختباري", lastUpdatedAt: null }] };
    },
  };
  const res = await invoke(claim, { body: { userId: 999 } });
  assert.equal(res.body.show, true);
  assert.equal(res.body.lastUpdatedAt, null);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});
test("disabled, already-shown or absent memberships do not show a reminder", async () => {
  globalThis.reminderDb = { execute: async () => ({ rows: [] }) };
  assert.deepEqual((await invoke(claim)).body, { show: false });
});
