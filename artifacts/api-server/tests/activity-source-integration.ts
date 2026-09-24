import assert from "node:assert/strict";
import { db, pool, projectsTable, activityGroupsTable, activitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getGroupSummary, refreshLinkedSources } from "../src/lib/external-sources";

// Development database only. All test fixtures are removed in finally.
if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  const projectIds: number[] = [];
  try {
    const suffix = `source-integration-${Date.now()}`;
    const base = {
      location: "test", ownerEntity: "test", supervisorEntity: "test",
      contractor: "test", noSchedule: true,
    };
    const [sourceProject, targetProject] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-source` },
      { ...base, name: `${suffix}-target` },
    ]).returning();
    projectIds.push(sourceProject.id, targetProject.id);

    const [sourceGroup] = await db.insert(activityGroupsTable).values({
      projectId: sourceProject.id, name: "Original source", linkCode: suffix,
    }).returning();
    const [, sourceItemB] = await db.insert(activitiesTable).values([
      {
        projectId: sourceProject.id, groupId: sourceGroup.id, name: "A",
        actualProgress: 20, weight: 1, plannedStartDate: "2026-01-10", plannedEndDate: "2026-02-01",
      },
      {
        projectId: sourceProject.id, groupId: sourceGroup.id, name: "B",
        actualProgress: 80, weight: 3, plannedStartDate: "2026-01-01", plannedEndDate: "2026-03-01",
      },
    ]).returning();
    const [target] = await db.insert(activitiesTable).values({
      projectId: targetProject.id, name: "Linked target",
      externalSourceGroupId: sourceGroup.id,
    }).returning();

    await refreshLinkedSources([sourceGroup.id]);
    let [updated] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, target.id));
    assert.equal(updated.externalSourceGroupId, sourceGroup.id);
    assert.equal(updated.groupId, null);
    assert.equal(updated.actualProgress, 65);
    assert.equal(updated.plannedStartDate, "2026-01-01");
    assert.equal(updated.plannedEndDate, "2026-03-01");
    let [targetProjectRow] = await db.select().from(projectsTable).where(eq(projectsTable.id, targetProject.id));
    assert.equal(targetProjectRow.overallProgress, 65);

    await db.update(activitiesTable).set({
      actualProgress: 100, plannedStartDate: "2025-12-01", plannedEndDate: "2026-04-01",
    }).where(eq(activitiesTable.id, sourceItemB.id));
    await refreshLinkedSources([sourceGroup.id]);
    [updated] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, target.id));
    assert.equal(updated.actualProgress, 80);
    assert.equal(updated.plannedStartDate, "2025-12-01");
    assert.equal(updated.plannedEndDate, "2026-04-01");

    await db.update(activityGroupsTable).set({ name: "Renamed source", linkCode: `${suffix}-changed` })
      .where(eq(activityGroupsTable.id, sourceGroup.id));
    const renamed = await getGroupSummary(sourceGroup.id);
    assert.equal(renamed?.groupName, "Renamed source");
    assert.equal(renamed?.actualProgress, 80);
    assert.equal(updated.externalSourceGroupId, sourceGroup.id);

    await db.delete(activitiesTable).where(eq(activitiesTable.id, sourceItemB.id));
    await refreshLinkedSources([sourceGroup.id]);
    [updated] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, target.id));
    assert.equal(updated.actualProgress, 20);
    assert.equal(updated.plannedStartDate, "2026-01-10");
    assert.equal(updated.plannedEndDate, "2026-02-01");

    await db.delete(activityGroupsTable).where(eq(activityGroupsTable.id, sourceGroup.id));
    assert.equal(await getGroupSummary(sourceGroup.id), null);
    await refreshLinkedSources([sourceGroup.id]); // no crash, preserve last snapshot
    [updated] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, target.id));
    assert.equal(updated.externalSourceGroupId, sourceGroup.id);
    assert.equal(updated.actualProgress, 20);
    await db.update(activitiesTable).set({ externalSourceGroupId: null }).where(eq(activitiesTable.id, target.id));
    [updated] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, target.id));
    assert.equal(updated.externalSourceGroupId, null);
    assert.equal(updated.actualProgress, 20);
    console.log("Linked progress, dates, stable ID, deletion and unlink checks passed");
  } finally {
    for (const projectId of projectIds) {
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});