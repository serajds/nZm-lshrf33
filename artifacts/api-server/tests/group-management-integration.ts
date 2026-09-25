import assert from "node:assert/strict";
import { db, pool, projectsTable, activityGroupsTable, activitiesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { deleteEmptyActivityGroup } from "../src/lib/delete-empty-activity-group";
import { getGroupSummary, withSourceGraphLock } from "../src/lib/external-sources";
import { reorderActivityGroups } from "../src/routes/activity-groups";

if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  const projectIds: number[] = [];
  try {
    const name = `group-management-check-${Date.now()}`;
    const base = {
      location: "test", ownerEntity: "test", supervisorEntity: "test",
      contractor: "test", noSchedule: true,
    };
    const [sourceProject, targetProject] = await db.insert(projectsTable).values([
      { ...base, name: `${name}-source` },
      { ...base, name: `${name}-target` },
    ]).returning();
    projectIds.push(sourceProject.id, targetProject.id);

    const [occupied, empty] = await db.insert(activityGroupsTable).values([
      { projectId: sourceProject.id, name: "Before", linkCode: name },
      { projectId: sourceProject.id, name: "Empty" },
    ]).returning();
    const [child] = await db.insert(activitiesTable).values({
      projectId: sourceProject.id, groupId: occupied.id, name: "Child",
      actualProgress: 40, plannedStartDate: "2026-01-01", plannedEndDate: "2026-02-01",
    }).returning();
    const [linked] = await db.insert(activitiesTable).values({
      projectId: targetProject.id, externalSourceGroupId: occupied.id, name: "Linked",
      actualProgress: 40, plannedStartDate: "2026-01-01", plannedEndDate: "2026-02-01",
    }).returning();

    const beforeInvalidReorder = await db.select({
      id: activityGroupsTable.id, sortOrder: activityGroupsTable.sortOrder,
    }).from(activityGroupsTable).where(eq(activityGroupsTable.projectId, sourceProject.id));
    assert.equal(await reorderActivityGroups(sourceProject.id, [occupied.id, occupied.id]), "invalid_order");
    assert.equal(await reorderActivityGroups(sourceProject.id, [occupied.id, linked.id]), "invalid_order");
    assert.equal(await reorderActivityGroups(sourceProject.id, [occupied.id]), "invalid_order");
    assert.equal(await reorderActivityGroups(sourceProject.id, [occupied.id, 0]), "invalid_order");
    assert.deepEqual(
      await db.select({ id: activityGroupsTable.id, sortOrder: activityGroupsTable.sortOrder })
        .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, sourceProject.id)),
      beforeInvalidReorder,
    );
    assert.equal(await reorderActivityGroups(sourceProject.id, [empty.id, occupied.id]), "reordered");
    let groupOrder = await db.select({ id: activityGroupsTable.id, sortOrder: activityGroupsTable.sortOrder })
      .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, sourceProject.id))
      .orderBy(activityGroupsTable.sortOrder);
    assert.deepEqual(groupOrder.map(group => group.id), [empty.id, occupied.id]);
    assert.deepEqual(groupOrder.map(group => group.sortOrder), [0, 1]);
    const concurrentReorders = await Promise.all([
      reorderActivityGroups(sourceProject.id, [occupied.id, empty.id]),
      reorderActivityGroups(sourceProject.id, [empty.id, occupied.id]),
    ]);
    assert.deepEqual(concurrentReorders, ["reordered", "reordered"]);
    groupOrder = await db.select({ id: activityGroupsTable.id, sortOrder: activityGroupsTable.sortOrder })
      .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, sourceProject.id))
      .orderBy(activityGroupsTable.sortOrder);
    assert.deepEqual(groupOrder.map(group => group.sortOrder), [0, 1]);
    assert.deepEqual(new Set(groupOrder.map(group => group.id)), new Set([occupied.id, empty.id]));

    // The existing update endpoint changes only the group metadata.
    await db.update(activityGroupsTable).set({ name: "After", linkCode: `${name}-renamed`, color: "#3b82f6" })
      .where(and(eq(activityGroupsTable.id, occupied.id), eq(activityGroupsTable.projectId, sourceProject.id)));
    const summary = await getGroupSummary(occupied.id);
    assert.equal(summary?.groupName, "After");
    assert.equal(summary?.linkCode, `${name}-renamed`);
    assert.equal(summary?.actualProgress, 40);
    const [unchangedLink] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, linked.id));
    assert.equal(unchangedLink.externalSourceGroupId, occupied.id);
    const [unchangedChild] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, child.id));
    assert.equal(unchangedChild.groupId, occupied.id);

    assert.equal(await deleteEmptyActivityGroup(sourceProject.id, occupied.id), "not_empty");
    const [stillPresent] = await db.select().from(activityGroupsTable).where(eq(activityGroupsTable.id, occupied.id));
    const [stillAssigned] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, child.id));
    assert.equal(stillPresent.id, occupied.id);
    assert.equal(stillAssigned.groupId, occupied.id);
    assert.equal(await deleteEmptyActivityGroup(targetProject.id, occupied.id), "not_found");

    assert.equal(await deleteEmptyActivityGroup(sourceProject.id, empty.id), "deleted");
    assert.equal((await db.select().from(activityGroupsTable).where(eq(activityGroupsTable.id, empty.id))).length, 0);
    assert.equal(await deleteEmptyActivityGroup(sourceProject.id, empty.id), "not_found");

    const [concurrent] = await db.insert(activityGroupsTable).values({
      projectId: sourceProject.id, name: "Concurrent",
    }).returning();
    let beginAssignment!: () => void;
    let finishAssignment!: () => void;
    const assignmentStarted = new Promise<void>(resolve => { beginAssignment = resolve; });
    const allowAssignment = new Promise<void>(resolve => { finishAssignment = resolve; });
    const assignment = withSourceGraphLock(async () => {
      const [group] = await db.select().from(activityGroupsTable).where(eq(activityGroupsTable.id, concurrent.id));
      assert.ok(group);
      beginAssignment();
      await allowAssignment;
      await db.insert(activitiesTable).values({
        projectId: sourceProject.id, groupId: concurrent.id, name: "Concurrent child",
      });
    });
    await assignmentStarted;
    const deleteDuringAssignment = deleteEmptyActivityGroup(sourceProject.id, concurrent.id);
    finishAssignment();
    await assignment;
    assert.equal(await deleteDuringAssignment, "not_empty");

    // An explicitly emptied source may be deleted; the external link retains
    // its ID and last copied values so the caller can show "source unavailable".
    await db.update(activitiesTable).set({ groupId: null }).where(eq(activitiesTable.id, child.id));
    assert.equal(await deleteEmptyActivityGroup(sourceProject.id, occupied.id), "deleted");
    assert.equal(await getGroupSummary(occupied.id), null);
    const [afterDelete] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, linked.id));
    assert.equal(afterDelete.externalSourceGroupId, occupied.id);
    assert.equal(afterDelete.actualProgress, 40);
    console.log("Group edit, empty deletion, blocked occupied deletion and external link checks passed");
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