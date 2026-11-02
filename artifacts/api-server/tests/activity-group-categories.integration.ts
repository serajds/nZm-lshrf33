// DEVELOPMENT only. Standalone test server with real auth and unusable-login
// fixture accounts. All temporary fixture rows are cleaned.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool, projectsTable, activityGroupsTable as groups, activitiesTable,
  activityGroupCategoriesTable as categories, usersTable, projectMembersTable,
  memberGroupAssignmentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import router from "../src/routes/activity-groups";
import { signToken } from "../src/lib/auth";

async function run() {
  const projectIds: number[] = [];
  let userId: number | undefined;
  const userIds: number[] = [];
  let server: ReturnType<express.Express["listen"]> | undefined;
  try {
    const fixtures = await db.insert(projectsTable).values([0, 1].map(index => ({
      name: `isolated-category-${randomUUID()}-${index}`, location: "test", ownerEntity: "test",
      supervisorEntity: "test", contractor: "test",
    }))).returning();
    projectIds.push(...fixtures.map(project => project.id));
    const [a, b, unclassified, foreign] = await db.insert(groups).values([
      { projectId: projectIds[0], name: "A", sortOrder: 10 },
      { projectId: projectIds[0], name: "B", sortOrder: 20, linkCode: `test-${randomUUID()}` },
      { projectId: projectIds[0], name: "C", sortOrder: 30 },
      { projectId: projectIds[1], name: "Foreign", sortOrder: 0 },
    ]).returning();
    const [activity] = await db.insert(activitiesTable).values({
      projectId: projectIds[0], groupId: a.id, name: "Preserve progress", actualProgress: 37,
      weight: 2, plannedStartDate: "2026-01-01", plannedEndDate: "2026-12-31",
    }).returning();
    const [user, admin] = await db.insert(usersTable).values([
      { fullName: "isolated classification test", phone: `test-${randomUUID()}`, passwordHash: "not-a-login-hash", role: "engineer" },
      { fullName: "isolated classification admin", phone: `test-${randomUUID()}`, passwordHash: "not-a-login-hash", role: "admin" },
    ]).returning();
    userIds.push(user.id, admin.id);
    userId = user.id;
    const adminToken = signToken({ userId: admin.id, phone: admin.phone, role: "admin" });
    const limitedToken = signToken({ userId, phone: user.phone, role: "engineer" });
    const [member] = await db.insert(projectMembersTable).values({
      projectId: projectIds[0], userId, role: "engineer", tabPermissions: { activities: "edit" },
    }).returning();
    await db.insert(memberGroupAssignmentsTable).values({ memberId: member.id, groupId: a.id });

    const app = express();
    app.use(express.json());
    app.use("/api", router);
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(error.message); res.status(500).json({ error: error.message });
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.on("listening", resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}/api/projects/${projectIds[0]}`;
    const call = async (path: string, method = "GET", body?: unknown, limited = false) => {
      const response = await fetch(base + path, { method, headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${limited ? limitedToken : adminToken}`,
      }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const assign = (body: unknown, limited = false) => call("/activity-group-categories/assign", "PUT", body, limited);
    const created = await assign({ groupIds: [a.id, b.id], categoryId: null, newCategoryName: " أعمال   معمارية " });
    assert.equal(created.status, 200);
    const id = created.data.category.id;
    assert.equal(created.data.category.name, "أعمال معمارية");
    let listed = await call("/activity-groups");
    assert.deepEqual(listed.data.map((group: any) => group.categoryId), [id, id, null]);
    const stripCategory = ({ categoryId: _categoryId, ...group }: any) => group;
    const { linkedProjectId, ...expectedGroup } = stripCategory(a);
    assert.deepEqual(stripCategory(listed.data[0]), { ...expectedGroup, linkedProjectActive: linkedProjectId !== null });
    assert.equal((await assign({ groupIds: [b.id], categoryId: null, newCategoryName: "أعمال معمارية" })).data.category.id, id);
    assert.equal((await call("/activity-group-categories")).data.length, 1);
    const second = await assign({ groupIds: [b.id], categoryId: null, newCategoryName: "كهرباء" });
    assert.equal(second.status, 200);
    assert.equal((await assign({ groupIds: [unclassified.id], categoryId: second.data.category.id })).status, 200);
    const categoriesBefore = (await call("/activity-group-categories")).data;
    assert.equal((await assign({ groupIds: [a.id, foreign.id], categoryId: null, newCategoryName: "Must not be created" })).status, 400);
    const [foreignCategory] = await db.insert(categories).values({ projectId: projectIds[1], name: "Foreign" }).returning();
    assert.equal((await assign({ groupIds: [a.id], categoryId: foreignCategory.id })).status, 400);
    assert.deepEqual((await call("/activity-group-categories")).data, categoriesBefore);
    assert.equal((await assign({ groupIds: [a.id, a.id], categoryId: id })).status, 400);
    assert.equal((await assign({ groupIds: [a.id], categoryId: id }, true)).status, 403);
    assert.equal((await call(`/activity-group-categories/${id}`, "PATCH", { name: "تشطيبات" })).status, 200);
    assert.equal((await call(`/activity-group-categories/${second.data.category.id}`, "PATCH", { name: "تشطيبات" })).status, 409);
    assert.equal((await assign({ groupIds: [b.id], categoryId: null })).status, 200);
    assert.equal((await call(`/activity-group-categories/${id}`, "DELETE")).status, 200);
    listed = await call("/activity-groups");
    assert.deepEqual(listed.data.map((group: any) => group.categoryId), [null, null, second.data.category.id]);
    const [after] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, activity.id));
    assert.deepEqual(after, activity);
    console.log("PASS: real HTTP+PostgreSQL bulk create/reuse/move/release, GET persistence, rename/delete, cross-project and limited-permission rejection; activity data unchanged.");
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (projectIds.length) {
      await db.delete(activitiesTable).where(inArray(activitiesTable.projectId, projectIds));
      await db.delete(groups).where(inArray(groups.projectId, projectIds));
      await db.delete(projectsTable).where(inArray(projectsTable.id, projectIds));
    }
    if (userIds.length) await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    await pool.end();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
