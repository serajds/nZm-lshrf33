import assert from "node:assert/strict";
import type { Server } from "node:http";
import { db, pool, projectsTable, activitiesTable, activityGroupsTable, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { signToken } from "../src/lib/auth";
import { refreshLinkedSources } from "../src/lib/external-sources";

if (process.env.NODE_ENV !== "development" || !process.env.DATABASE_URL) {
  throw new Error("Final regression fixtures require an explicitly selected development database");
}

const projectIds: number[] = [];
let userId: number | undefined;
let server: Server | undefined;

async function main() {
  try {
    const suffix = `final-hardening-check-${Date.now()}`;
    const today = new Date();
    const day = (offset: number) => {
      const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const [user] = await db.insert(usersTable).values({
      phone: suffix, passwordHash: "temporary-test-only", fullName: "Temporary regression", role: "admin",
    }).returning();
    userId = user.id;
    const base = { location: "temporary-test", ownerEntity: "test", supervisorEntity: "test", contractor: "test", noSchedule: false };
    const [reference, source, target] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-reference`, startDate: day(-3), expectedEndDate: day(1) },
      { ...base, name: `${suffix}-source`, startDate: day(-1), expectedEndDate: day(3) },
      { ...base, name: `${suffix}-target`, startDate: day(-1), expectedEndDate: day(3) },
    ]).returning();
    projectIds.push(reference.id, source.id, target.id);
    await db.insert(activitiesTable).values({
      projectId: reference.id, name: "Reference 75/45", weight: 1, actualProgress: 45,
      plannedStartDate: day(-3), plannedEndDate: day(1),
    });
    const [sourceGroup] = await db.insert(activityGroupsTable).values({ projectId: source.id, name: "Source" }).returning();
    const [targetGroup] = await db.insert(activityGroupsTable).values({ projectId: target.id, name: "Target" }).returning();
    await db.insert(activitiesTable).values({
      projectId: source.id, groupId: sourceGroup.id, name: "Source 25/25",
      weight: 1, actualProgress: 25, plannedStartDate: day(-1), plannedEndDate: day(3),
    });
    const [linked] = await db.insert(activitiesTable).values({
      projectId: target.id, groupId: targetGroup.id, externalSourceGroupId: sourceGroup.id,
      name: "Linked 25/25", weight: 1, actualProgress: 0, plannedProgress: 0,
    }).returning();
    await refreshLinkedSources([sourceGroup.id]);
    const [refreshed] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, linked.id));
    assert.equal(refreshed.externalSourceGroupId, sourceGroup.id);
    assert.equal(refreshed.actualProgress, 25);
    assert.equal(refreshed.plannedProgress, 25);

    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const headers = { authorization: `Bearer ${signToken({ userId, phone: user.phone, role: "admin" })}` };
    const get = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, { headers });
      assert.equal(response.status, 200, `${path}: ${response.status}`);
      return response.json() as Promise<Record<string, number | null>>;
    };
    const summary = await get(`/projects/${reference.id}/summary`);
    assert.equal(summary.plannedProgress, 75);
    assert.equal(summary.overallProgress, 45);
    assert.equal(summary.spi, 0.6);
    const targetSummary = await get(`/projects/${target.id}/summary`);
    assert.equal(targetSummary.plannedProgress, 25);
    assert.equal(targetSummary.overallProgress, 25);
    assert.equal(targetSummary.spi, 1);
    console.log("Reference 75/45/SPI 0.60 and linked source 25/25 persisted and served by the API");
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close(error => error ? reject(error) : resolve()));
    for (const projectId of projectIds.reverse()) {
      await db.delete(auditLogTable).where(eq(auditLogTable.projectId, projectId));
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    if (userId != null) await db.delete(usersTable).where(eq(usersTable.id, userId));
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});