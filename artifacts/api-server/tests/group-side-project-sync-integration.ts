import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { db, pool, projectsTable, activityGroupsTable, activitiesTable, usersTable, projectMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  deleteProjectUnderSourceGraphLock,
  createActivityGroupUnderSourceGraphLock,
  getGroupSummary,
  hasLinkedGroupSourceDuplicate,
  reconcileGroupToSideProject,
  reconcileTargetsLinkedToProject,
  refreshLinkedSources,
  withSourceGraphLock,
} from "../src/lib/external-sources";
import { signToken } from "../src/lib/auth";
import activitiesRouter from "../src/routes/activities";
import activityGroupsRouter from "../src/routes/activity-groups";

if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  const projectIds: number[] = [];
  const userIds: number[] = [];
  let server: Server | undefined;
  try {
    const suffix = `side-sync-${Date.now()}`;
    const base = { location: "test", ownerEntity: "test", supervisorEntity: "test", contractor: "test", noSchedule: true };
    const projects = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-source` },
      { ...base, name: `${suffix}-target` },
      { ...base, name: `${suffix}-downstream` },
      { ...base, name: `${suffix}-empty-a` },
      { ...base, name: `${suffix}-empty-b` },
    ]).returning();
    const [sourceProject, targetProject, downstreamProject, emptyA, emptyB] = projects;
    projectIds.push(...projects.map(project => project.id));

    const [sourceGroup, targetGroup, downstreamGroup] = await db.insert(activityGroupsTable).values([
      { projectId: sourceProject.id, name: "Source one" },
      { projectId: targetProject.id, name: "Target" },
      { projectId: downstreamProject.id, name: "Downstream" },
    ]).returning();
    const [sourceActivity] = await db.insert(activitiesTable).values({
      projectId: sourceProject.id, groupId: sourceGroup.id, name: "Child",
      actualProgress: 40, plannedStartDate: "2026-02-10", plannedEndDate: "2026-05-01",
    }).returning();

    const initial = await reconcileGroupToSideProject(targetGroup.id, sourceProject.id);
    assert.equal(initial.created, 1);
    assert.equal(initial.updated, 0);
    assert.equal(initial.group?.linkedProjectId, sourceProject.id);
    let managed = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    assert.equal(managed.length, 1);
    assert.equal(managed[0].groupId, targetGroup.id);
    assert.equal(managed[0].projectId, targetProject.id);
    assert.equal(managed[0].externalSourceGroupId, sourceGroup.id);
    assert.equal(managed[0].name, "Source one");
    assert.equal(managed[0].actualProgress, 40);
    assert.equal(managed[0].status, "in_progress");
    assert.equal(managed[0].plannedStartDate, "2026-02-10");
    assert.equal(managed[0].plannedEndDate, "2026-05-01");
    assert.equal(await hasLinkedGroupSourceDuplicate(db, targetGroup.id, sourceGroup.id), true);
    assert.equal(await hasLinkedGroupSourceDuplicate(db, targetGroup.id, sourceGroup.id, managed[0].id), false);

    // The source started without a code (trusted group-to-project sync) and is
    // now explicitly made shareable for the individual-link API checks below.
    await db.update(activityGroupsTable).set({ linkCode: `${suffix}-source-code` })
      .where(eq(activityGroupsTable.id, sourceGroup.id));
    const [testUser] = await db.insert(usersTable).values({
      phone: `${suffix}-admin`, passwordHash: "integration-test", fullName: "Integration Admin", role: "admin",
    }).returning();
    userIds.push(testUser.id);
    const app = express();
    app.use(express.json());
    app.use(activitiesRouter);
    app.use(activityGroupsRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const apiBase = `http://127.0.0.1:${address.port}/projects/${targetProject.id}/activities`;
    const authorization = `Bearer ${signToken({ userId: testUser.id, phone: testUser.phone, role: "admin" })}`;
    const duplicateCreate = await fetch(apiBase, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "Duplicate manual item", groupId: targetGroup.id, externalSourceGroupId: sourceGroup.id }),
    });
    assert.equal(duplicateCreate.status, 409);
    const [manualExternal] = await db.insert(activitiesTable).values({
      projectId: targetProject.id, name: "Manual individual link",
      externalSourceGroupId: sourceGroup.id,
    }).returning();
    const duplicatePatch = await fetch(`${apiBase}/${manualExternal.id}`, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ groupId: targetGroup.id }),
    });
    assert.equal(duplicatePatch.status, 409);
    const duplicateReorder = await fetch(`${apiBase}/reorder`, {
      method: "PUT",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ items: [{ id: manualExternal.id, sortOrder: 10, groupId: targetGroup.id }] }),
    });
    assert.equal(duplicateReorder.status, 409);
    const [stillIndividual] = await db.select().from(activitiesTable).where(eq(activitiesTable.id, manualExternal.id));
    assert.equal(stillIndividual.groupId, null);
    assert.equal(stillIndividual.externalSourceGroupId, sourceGroup.id);
    const activeManagedEdit = await fetch(`${apiBase}/${managed[0].id}`, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    assert.equal(activeManagedEdit.status, 409);
    const localManagedUpdate = await fetch(`${apiBase}/${managed[0].id}`, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ weight: 2, sortOrder: 42 }),
    });
    assert.equal(localManagedUpdate.status, 200);
    const restoreManagedLocalFields = await fetch(`${apiBase}/${managed[0].id}`, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ weight: 1, sortOrder: managed[0].sortOrder }),
    });
    assert.equal(restoreManagedLocalFields.status, 200);

    // Exercise the side-project endpoints and source-group lifecycle through
    // real HTTP middleware, including both tab-access and source-read checks.
    const [httpSource, httpTarget] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-http-source` },
      { ...base, name: `${suffix}-http-target` },
    ]).returning();
    projectIds.push(httpSource.id, httpTarget.id);
    const targetGroupResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP target" }),
    });
    assert.equal(targetGroupResponse.status, 201);
    const httpTargetGroup = await targetGroupResponse.json() as { id: number };

    const [engineer] = await db.insert(usersTable).values({
      phone: `${suffix}-engineer`, passwordHash: "integration-test", fullName: "Integration Engineer", role: "engineer",
    }).returning();
    const [viewer] = await db.insert(usersTable).values({
      phone: `${suffix}-viewer`, passwordHash: "integration-test", fullName: "Integration Viewer", role: "engineer",
    }).returning();
    userIds.push(engineer.id, viewer.id);
    await db.insert(projectMembersTable).values([
      {
        projectId: httpTarget.id,
        userId: engineer.id,
        role: "engineer",
        tabPermissions: { activities: "edit" },
      },
      { projectId: httpTarget.id, userId: viewer.id, role: "viewer" },
    ]);
    const engineerAuth = `Bearer ${signToken({ userId: engineer.id, phone: engineer.phone, role: engineer.role })}`;
    const viewerAuth = `Bearer ${signToken({ userId: viewer.id, phone: viewer.phone, role: viewer.role })}`;
    const linkUrl = `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/linked-project`;
    const selfLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: httpTarget.id }),
    });
    assert.equal(selfLink.status, 400);
    const invalidProjectLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: 2_000_000_000 }),
    });
    assert.equal(invalidProjectLink.status, 404);
    const forbiddenSourceLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: httpSource.id }),
    });
    assert.equal(forbiddenSourceLink.status, 403);
    const viewerLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: viewerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: httpSource.id }),
    });
    assert.equal(viewerLink.status, 403);
    const attach = await fetch(linkUrl, {
      method: "PUT", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: httpSource.id }),
    });
    assert.equal(attach.status, 200);
    const attachBody = await attach.json() as { group: { linkedProjectId: number }; created: number };
    assert.equal(attachBody.group.linkedProjectId, httpSource.id);
    assert.equal(attachBody.created, 0);
    const emptySync = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/sync`, {
      method: "POST", headers: { authorization },
    });
    assert.equal(emptySync.status, 200);
    assert.equal((await emptySync.json() as { created: number }).created, 0);

    const sourceGroupResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}/activity-groups`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP source group" }),
    });
    assert.equal(sourceGroupResponse.status, 201);
    const httpSourceGroup = await sourceGroupResponse.json() as { id: number };
    let httpManaged = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, httpTargetGroup.id));
    assert.equal(httpManaged.length, 1);

    const sourceActivityResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}/activities`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        name: "HTTP source activity",
        groupId: httpSourceGroup.id,
        actualProgress: 75,
        plannedStartDate: "2026-03-01",
        plannedEndDate: "2026-04-01",
      }),
    });
    assert.equal(sourceActivityResponse.status, 201);
    const sourceActivityBody = await sourceActivityResponse.json() as { id: number };
    const materializedSync = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/sync`, {
      method: "POST", headers: { authorization },
    });
    assert.equal(materializedSync.status, 200);
    const materializedSyncBody = await materializedSync.json() as { created: number; updated: number };
    assert.equal(materializedSyncBody.created, 0);
    assert.equal(materializedSyncBody.updated, 0);
    const httpActivitiesUrl = `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activities`;
    let httpActivities = await fetch(httpActivitiesUrl, { headers: { authorization } });
    assert.equal(httpActivities.status, 200);
    const httpActivityRows = await httpActivities.json() as Array<{
      id: number; actualProgress: number; externalSource?: { available: boolean };
    }>;
    const generatedHttpActivity = httpActivityRows.find(activity => activity.id === httpManaged[0].id)!;
    assert.equal(generatedHttpActivity.actualProgress, 75);
    assert.equal(generatedHttpActivity.externalSource?.available, true);
    const [httpTargetProgress] = await db.select({ overallProgress: projectsTable.overallProgress })
      .from(projectsTable).where(eq(projectsTable.id, httpTarget.id));
    assert.equal(httpTargetProgress.overallProgress, 75);

    const renameSourceGroup = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}/activity-groups/${httpSourceGroup.id}`, {
      method: "PUT",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP source renamed", linkCode: `${suffix}-http-source-code` }),
    });
    assert.equal(renameSourceGroup.status, 200);
    httpManaged = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, httpTargetGroup.id));
    assert.equal(httpManaged[0].name, "HTTP source renamed");
    const sourceActivityDelete = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}/activities/${sourceActivityBody.id}`, {
      method: "DELETE", headers: { authorization },
    });
    assert.equal(sourceActivityDelete.status, 204);
    const sourceGroupDelete = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}/activity-groups/${httpSourceGroup.id}`, {
      method: "DELETE", headers: { authorization },
    });
    assert.equal(sourceGroupDelete.status, 204);
    const snapshotBeforeUnavailable = (await db.select().from(activitiesTable)
      .where(eq(activitiesTable.id, httpManaged[0].id)))[0];
    const unavailableSync = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/sync`, {
      method: "POST", headers: { authorization },
    });
    assert.equal(unavailableSync.status, 200);
    assert.equal((await unavailableSync.json() as { unavailable: number }).unavailable, 1);
    httpActivities = await fetch(httpActivitiesUrl, { headers: { authorization } });
    const unavailableRows = await httpActivities.json() as Array<{
      id: number; actualProgress: number; externalSource?: { available: boolean };
    }>;
    const unavailableActivity = unavailableRows.find(activity => activity.id === httpManaged[0].id)!;
    assert.equal(unavailableActivity.externalSource?.available, false);
    assert.equal(unavailableActivity.actualProgress, snapshotBeforeUnavailable.actualProgress);

    const repeat = await reconcileGroupToSideProject(targetGroup.id, sourceProject.id);
    assert.equal(repeat.created, 0);
    assert.equal(repeat.updated, 0);

    const [newSourceGroup] = await db.insert(activityGroupsTable).values({
      projectId: sourceProject.id, name: "Source two",
    }).returning();
    const newGroupSync = await reconcileTargetsLinkedToProject(sourceProject.id);
    assert.equal(newGroupSync.created, 1);
    managed = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    assert.equal(managed.length, 2);
    assert.ok(managed.some(activity => activity.externalSourceGroupId === newSourceGroup.id));

    await db.update(activityGroupsTable).set({ name: "Renamed source", linkCode: "source-renamed" })
      .where(eq(activityGroupsTable.id, sourceGroup.id));
    await reconcileTargetsLinkedToProject(sourceProject.id);
    managed = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    const renamed = managed.find(activity => activity.externalSourceGroupId === sourceGroup.id)!;
    assert.equal(renamed.name, "Renamed source");

    const downstreamAttach = await reconcileGroupToSideProject(downstreamGroup.id, targetProject.id);
    assert.equal(downstreamAttach.created, 1);
    await db.update(activitiesTable).set({ actualProgress: 100 })
      .where(eq(activitiesTable.id, sourceActivity.id));
    await refreshLinkedSources([sourceGroup.id]);
    const [propagated] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.managedByGroupId, downstreamGroup.id));
    assert.equal(propagated.actualProgress, 50);
    assert.equal(propagated.status, "in_progress");

    const detached = await reconcileGroupToSideProject(targetGroup.id, null);
    assert.equal(detached.group?.linkedProjectId, null);
    const afterDetach = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    assert.equal(afterDetach.length, 2);
    const detachedManagedId = afterDetach.find(activity => activity.externalSourceGroupId === sourceGroup.id)!.id;
    const lockedStatus = await fetch(`${apiBase}/${detachedManagedId}`, {
      method: "PATCH",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "Locally renamed while detached", status: "completed" }),
    });
    assert.equal(lockedStatus.status, 200);

    // Detach stops group-name management but retains the individual external
    // activity link: source progress and dates continue to refresh.
    await db.update(activityGroupsTable).set({ name: "Changed while detached" })
      .where(eq(activityGroupsTable.id, sourceGroup.id));
    await db.update(activitiesTable).set({ actualProgress: 70, plannedEndDate: "2026-06-01" })
      .where(eq(activitiesTable.id, sourceActivity.id));
    await refreshLinkedSources([sourceGroup.id]);
    const [detachedSnapshot] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.id, detachedManagedId));
    assert.equal(detachedSnapshot.actualProgress, 70);
    assert.equal(detachedSnapshot.plannedEndDate, "2026-06-01");
    assert.equal(detachedSnapshot.name, "Locally renamed while detached");
    assert.equal(detachedSnapshot.status, "completed");
    await refreshLinkedSources([sourceGroup.id]);
    const [editableDetached] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.id, detachedSnapshot.id));
    assert.equal(editableDetached.status, "completed");

    const [reverseGroup] = await db.insert(activityGroupsTable).values({
      projectId: sourceProject.id, name: "Cycle back",
    }).returning();
    // Individual external linkage remains a graph edge even after detaching
    // group management, so the reverse edge still must be rejected.
    assert.equal((await reconcileGroupToSideProject(reverseGroup.id, targetProject.id)).conflict, "cycle");

    // Declared group subscriptions must block cycles before either project has
    // activities or source groups to materialize.
    const [emptyGroupA] = await db.insert(activityGroupsTable).values({
      projectId: emptyA.id, name: "Empty A group",
    }).returning();
    assert.equal((await reconcileGroupToSideProject(emptyGroupA.id, emptyB.id)).created, 0);
    const [emptyGroupB] = await db.insert(activityGroupsTable).values({
      projectId: emptyB.id, name: "Empty B group",
    }).returning();
    assert.equal((await reconcileGroupToSideProject(emptyGroupB.id, emptyA.id)).conflict, "cycle");

    const [deleteTarget, subscriberProject] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-delete-target` },
      { ...base, name: `${suffix}-subscriber` },
    ]).returning();
    projectIds.push(deleteTarget.id, subscriberProject.id);
    const [raceSourceGroup, subscriberGroup] = await db.insert(activityGroupsTable).values([
      { projectId: deleteTarget.id, name: "Race source group" },
      { projectId: subscriberProject.id, name: "Subscriber group" },
    ]).returning();
    await db.insert(activitiesTable).values({
      projectId: deleteTarget.id,
      groupId: raceSourceGroup.id,
      name: "Local source snapshot",
      actualProgress: 30,
      plannedStartDate: "2026-01-01",
      plannedEndDate: "2026-02-01",
    });
    assert.equal((await reconcileGroupToSideProject(subscriberGroup.id, deleteTarget.id)).created, 1);
    const [subscriberSnapshot] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.managedByGroupId, subscriberGroup.id));
    const beforeDelete = {
      externalSourceGroupId: subscriberSnapshot.externalSourceGroupId,
      actualProgress: subscriberSnapshot.actualProgress,
      name: subscriberSnapshot.name,
    };

    let signalHeld!: () => void;
    let allowRelease!: () => void;
    const held = new Promise<void>(resolve => { signalHeld = resolve; });
    const release = new Promise<void>(resolve => { allowRelease = resolve; });
    const lockHolder = withSourceGraphLock(async () => {
      signalHeld();
      await release;
    });
    await held;
    // Queue reconciliation first and deletion second behind the same graph lock.
    const reconciliation = reconcileGroupToSideProject(raceSourceGroup.id, sourceProject.id);
    const deletion = deleteProjectUnderSourceGraphLock(deleteTarget.id);
    allowRelease();
    const [racedSync, deletedProject] = await Promise.all([reconciliation, deletion]);
    await lockHolder;
    assert.equal(racedSync.group?.id, raceSourceGroup.id);
    assert.equal(deletedProject?.id, deleteTarget.id);
    assert.equal(await getGroupSummary(raceSourceGroup.id), null);
    assert.equal((await db.select().from(activitiesTable).where(eq(activitiesTable.projectId, deleteTarget.id))).length, 0);
    assert.equal((await db.select().from(activityGroupsTable).where(eq(activityGroupsTable.projectId, deleteTarget.id))).length, 0);
    await refreshLinkedSources([raceSourceGroup.id]);
    const [survivingSubscriber] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.id, subscriberSnapshot.id));
    assert.equal(survivingSubscriber.externalSourceGroupId, beforeDelete.externalSourceGroupId);
    assert.equal(survivingSubscriber.actualProgress, beforeDelete.actualProgress);
    assert.equal(survivingSubscriber.name, beforeDelete.name);

    const [createFirstProject] = await db.insert(projectsTable).values({
      ...base, name: `${suffix}-create-first`,
    }).returning();
    projectIds.push(createFirstProject.id);
    let createdLockReady!: () => void;
    let allowCreateRace!: () => void;
    const createLockHeld = new Promise<void>(resolve => { createdLockReady = resolve; });
    const createLockRelease = new Promise<void>(resolve => { allowCreateRace = resolve; });
    const createLockHolder = withSourceGraphLock(async () => {
      createdLockReady();
      await createLockRelease;
    });
    await createLockHeld;
    const groupCreate = createActivityGroupUnderSourceGraphLock(createFirstProject.id, {
      name: "Created before delete", color: "#123456", linkCode: null,
    });
    const projectDelete = deleteProjectUnderSourceGraphLock(createFirstProject.id);
    allowCreateRace();
    const [createdBeforeDelete, deletedAfterCreate] = await Promise.all([groupCreate, projectDelete]);
    await createLockHolder;
    assert.ok(createdBeforeDelete);
    assert.equal(deletedAfterCreate?.id, createFirstProject.id);
    assert.equal((await db.select().from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, createFirstProject.id))).length, 0);

    const [deleteFirstProject] = await db.insert(projectsTable).values({
      ...base, name: `${suffix}-delete-first`,
    }).returning();
    projectIds.push(deleteFirstProject.id);
    let deleteLockReady!: () => void;
    let allowDeleteRace!: () => void;
    const deleteLockHeld = new Promise<void>(resolve => { deleteLockReady = resolve; });
    const deleteLockRelease = new Promise<void>(resolve => { allowDeleteRace = resolve; });
    const deleteLockHolder = withSourceGraphLock(async () => {
      deleteLockReady();
      await deleteLockRelease;
    });
    await deleteLockHeld;
    const projectDeleteFirst = deleteProjectUnderSourceGraphLock(deleteFirstProject.id);
    const groupCreateAfterDelete = createActivityGroupUnderSourceGraphLock(deleteFirstProject.id, {
      name: "Must not orphan", color: "#654321", linkCode: null,
    });
    allowDeleteRace();
    const [deletedFirst, rejectedGroupCreate] = await Promise.all([projectDeleteFirst, groupCreateAfterDelete]);
    await deleteLockHolder;
    assert.equal(deletedFirst?.id, deleteFirstProject.id);
    assert.equal(rejectedGroupCreate, undefined);
    assert.equal((await db.select().from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, deleteFirstProject.id))).length, 0);
    const createForDeletedProject = await fetch(`http://127.0.0.1:${address.port}/projects/${deleteFirstProject.id}/activity-groups`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "Deleted project group" }),
    });
    assert.equal(createForDeletedProject.status, 404);

    let detachLockReady!: () => void;
    let allowDetachRace!: () => void;
    const detachLockHeld = new Promise<void>(resolve => { detachLockReady = resolve; });
    const detachLockRelease = new Promise<void>(resolve => { allowDetachRace = resolve; });
    const detachLockHolder = withSourceGraphLock(async () => {
      detachLockReady();
      await detachLockRelease;
    });
    await detachLockHeld;
    const explicitDetach = reconcileGroupToSideProject(targetGroup.id, null);
    const staleSync = reconcileGroupToSideProject(targetGroup.id, sourceProject.id, true, sourceProject.id);
    allowDetachRace();
    const [detachedFirst, staleSyncResult] = await Promise.all([explicitDetach, staleSync]);
    await detachLockHolder;
    assert.equal(detachedFirst.group?.linkedProjectId, null);
    assert.equal(staleSyncResult.conflict, "link_changed");
    const [stillDetachedGroup] = await db.select().from(activityGroupsTable)
      .where(eq(activityGroupsTable.id, targetGroup.id));
    assert.equal(stillDetachedGroup.linkedProjectId, null);

    const originalManagedIds = new Set(afterDetach.map(activity => activity.id));
    const reattached = await reconcileGroupToSideProject(targetGroup.id, sourceProject.id);
    assert.equal(reattached.created, 1); // The reverse group was added while detached.
    let reattachedManaged = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    assert.equal(reattachedManaged.length, 3);
    assert.ok([...originalManagedIds].every(id => reattachedManaged.some(activity => activity.id === id)));
    assert.equal(reattachedManaged.filter(activity => activity.externalSourceGroupId === reverseGroup.id).length, 1);
    const [reattachedSnapshot] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.id, detachedManagedId));
    assert.equal(reattachedSnapshot.name, "Changed while detached");
    const reattachedRepeat = await reconcileGroupToSideProject(targetGroup.id, sourceProject.id);
    assert.equal(reattachedRepeat.created, 0);
    reattachedManaged = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.managedByGroupId, targetGroup.id));
    assert.equal(reattachedManaged.length, 3);

    await db.delete(activityGroupsTable).where(eq(activityGroupsTable.id, newSourceGroup.id));
    const missing = await reconcileGroupToSideProject(targetGroup.id, sourceProject.id);
    assert.equal(missing.unavailable, 1);
    const [preserved] = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.externalSourceGroupId, newSourceGroup.id));
    assert.equal(preserved.name, "Source two");

    assert.equal((await reconcileGroupToSideProject(reverseGroup.id, targetProject.id)).conflict, "cycle");
    console.log("Side-project group reconciliation, propagation, detach and cycle checks passed");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    for (const projectId of projectIds) {
      await db.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
      await db.delete(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
      await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
      assert.equal((await db.select({ id: projectsTable.id }).from(projectsTable)
        .where(eq(projectsTable.id, projectId))).length, 0);
      assert.equal((await db.select({ id: activitiesTable.id }).from(activitiesTable)
        .where(eq(activitiesTable.projectId, projectId))).length, 0);
      assert.equal((await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
        .where(eq(activityGroupsTable.projectId, projectId))).length, 0);
    }
    for (const userId of userIds) {
      await db.delete(usersTable).where(eq(usersTable.id, userId));
      assert.equal((await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId))).length, 0);
    }
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});