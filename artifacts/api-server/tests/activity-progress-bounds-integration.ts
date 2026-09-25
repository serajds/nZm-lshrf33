import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { db, pool, activitiesTable, projectsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken } from "../src/lib/auth";
import activitiesRouter from "../src/routes/activities";

if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  let projectId: number | undefined;
  let userId: number | undefined;
  let server: Server | undefined;
  try {
    const suffix = `progress-bounds-${Date.now()}`;
    const [project] = await db.insert(projectsTable).values({
      name: suffix, location: "test", ownerEntity: "test",
      supervisorEntity: "test", contractor: "test", noSchedule: true,
    }).returning();
    projectId = project.id;
    const [user] = await db.insert(usersTable).values({
      phone: suffix, passwordHash: "integration-test", fullName: "Progress Test", role: "admin",
    }).returning();
    userId = user.id;

    const app = express();
    app.use(express.json());
    app.use(activitiesRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server has no port");

    const url = `http://127.0.0.1:${address.port}/projects/${projectId}/activities`;
    const headers = {
      authorization: `Bearer ${signToken({ userId: user.id, phone: user.phone, role: user.role })}`,
      "content-type": "application/json",
    };
    const create = (name: string, actualProgress: number, weight = 1) =>
      fetch(url, { method: "POST", headers, body: JSON.stringify({ name, actualProgress, weight }) });
    const update = (id: number, actualProgress: number) =>
      fetch(`${url}/${id}`, { method: "PATCH", headers, body: JSON.stringify({ actualProgress }) });
    const assertState = async (aId: number, bId: number, aProgress: number, bProgress: number, overall: number) => {
      const rows = await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      assert.equal(rows.length, 2);
      assert.equal(rows.find(row => row.id === aId)?.actualProgress, aProgress);
      assert.equal(rows.find(row => row.id === bId)?.actualProgress, bProgress);
      const [storedProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
      assert.equal(storedProject.overallProgress, overall);
    };

    const first = await create("Weighted activity", 0, 3);
    assert.equal(first.status, 201);
    const a = await first.json() as { id: number };
    const second = await create("Other activity", 5);
    assert.equal(second.status, 201);
    const b = await second.json() as { id: number };
    await assertState(a.id, b.id, 0, 5, 1.3);

    assert.equal((await update(a.id, 95)).status, 200);
    await assertState(a.id, b.id, 95, 5, 72.5);
    assert.equal((await update(a.id, 100)).status, 200);
    await assertState(a.id, b.id, 100, 5, 76.3);
    assert.equal((await update(b.id, 0)).status, 200);
    await assertState(a.id, b.id, 100, 0, 75);
    assert.equal((await update(b.id, 5)).status, 200);
    await assertState(a.id, b.id, 100, 5, 76.3);

    for (const invalid of [-5, 105]) {
      const createResponse = await create(`Invalid ${invalid}`, invalid);
      assert.equal(createResponse.status, 400);
      assert.equal((await createResponse.json() as { error: string }).error, "نسبة الإنجاز يجب أن تكون بين 0 و100");
      const updateResponse = await update(a.id, invalid);
      assert.equal(updateResponse.status, 400);
      assert.equal((await updateResponse.json() as { error: string }).error, "نسبة الإنجاز يجب أن تكون بين 0 و100");
      await assertState(a.id, b.id, 100, 5, 76.3);
    }

    console.log("Activity progress API bounds, persistence and weighted project progress checks passed");
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
    if (projectId !== undefined) {
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    if (userId !== undefined) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});