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
import projectsRouter from "../src/routes/projects";
import dashboardRouter from "../src/routes/dashboard";
import ownerRouter from "../src/routes/owner";

if (process.env.NODE_ENV === "production" || !process.env.DATABASE_URL) {
  throw new Error("This integration check requires a development database");
}

async function main() {
  const projectIds: number[] = [];
  const userIds: number[] = [];
  let server: Server | undefined;
  try {
    const suffix = `side-sync-${Date.now()}`;
    const projectCodeOne = `SOURCE-${suffix.slice(-8)}-ONE`;
    const projectCodeTwo = `SOURCE-${suffix.slice(-8)}-TWO`;
    const wrongProjectCode = `MISSING-${suffix.slice(-8)}-CODE`;
    const temporaryTargetCode = `TARGET-${suffix.slice(-8)}-CODE`;
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
    app.use(projectsRouter);
    app.use(dashboardRouter);
    app.use(ownerRouter);
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const apiBase = `http://127.0.0.1:${address.port}/projects/${targetProject.id}/activities`;
    const authorization = `Bearer ${signToken({ userId: testUser.id, phone: testUser.phone, role: "admin" })}`;
    const today = new Date();
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const day = (offset: number) => {
      const value = new Date(todayUtc);
      value.setUTCDate(value.getUTCDate() + offset);
      return value.toISOString().slice(0, 10);
    };
    const schedule = { noSchedule: false, startDate: day(-20), expectedEndDate: day(20) };
    const [metricsSourceProject, metricsTargetProject, weightedProject] = await db.insert(projectsTable).values([
      { ...base, ...schedule, name: `${suffix}-metrics-source` },
      { ...base, ...schedule, name: `${suffix}-metrics-target` },
      { ...base, ...schedule, name: `${suffix}-weighted-target` },
    ]).returning();
    projectIds.push(metricsSourceProject.id, metricsTargetProject.id, weightedProject.id);
    const [metricsSourceGroup, metricsTargetGroup] = await db.insert(activityGroupsTable).values([
      { projectId: metricsSourceProject.id, name: "Weighted source children" },
      { projectId: metricsTargetProject.id, name: "Generated source group" },
    ]).returning();
    await db.insert(activitiesTable).values([
      {
        projectId: metricsSourceProject.id,
        groupId: metricsSourceGroup.id,
        name: "No planned progress",
        actualProgress: 25,
        weight: 1,
        plannedStartDate: day(1),
        plannedEndDate: day(5),
      },
      {
        projectId: metricsSourceProject.id,
        groupId: metricsSourceGroup.id,
        name: "Half planned progress",
        actualProgress: 25,
        weight: 1,
        plannedStartDate: day(-4),
        plannedEndDate: day(4),
      },
    ]);
    await db.insert(activitiesTable).values([
      {
        projectId: weightedProject.id,
        name: "Heavy completed schedule",
        actualProgress: 60,
        weight: 3,
        plannedStartDate: day(-10),
        plannedEndDate: day(-1),
      },
      {
        projectId: weightedProject.id,
        name: "Not-yet-started schedule",
        actualProgress: 0,
        weight: 1,
        plannedStartDate: day(1),
        plannedEndDate: day(10),
      },
    ]).returning();
    const metricsSync = await reconcileGroupToSideProject(metricsTargetGroup.id, metricsSourceProject.id);
    assert.equal(metricsSync.created, 1);
    const generatedMetricsActivityId = (await db.select({ id: activitiesTable.id })
      .from(activitiesTable).where(eq(activitiesTable.managedByGroupId, metricsTargetGroup.id)))[0].id;
    // Ensure API consumers resolve the source now instead of trusting an old
    // generated-row snapshot.
    await db.update(activitiesTable).set({ actualProgress: 0, plannedProgress: 0 })
      .where(eq(activitiesTable.id, generatedMetricsActivityId));
    const metricsActivitiesResponse = await fetch(
      `http://127.0.0.1:${address.port}/projects/${metricsTargetProject.id}/activities`,
      { headers: { authorization } },
    );
    assert.equal(metricsActivitiesResponse.status, 200);
    const metricsActivities = await metricsActivitiesResponse.json() as Array<{
      id: number; actualProgress: number; plannedProgress: number;
    }>;
    const generatedMetricsActivity = metricsActivities.find(activity => activity.id === generatedMetricsActivityId)!;
    assert.equal(generatedMetricsActivity.actualProgress, 25);
    assert.equal(generatedMetricsActivity.plannedProgress, 25);
    const metricsSummary = await (await fetch(
      `http://127.0.0.1:${address.port}/projects/${metricsTargetProject.id}/summary`,
      { headers: { authorization } },
    )).json() as { overallProgress: number; plannedProgress: number; spi: number };
    assert.equal(metricsSummary.overallProgress, 25);
    assert.equal(metricsSummary.plannedProgress, 25);
    assert.equal(metricsSummary.spi, 1);
    const metricsDeviation = await (await fetch(
      `http://127.0.0.1:${address.port}/projects/${metricsTargetProject.id}/deviation`,
      { headers: { authorization } },
    )).json() as { actualProgress: number; plannedProgress: number; spi: number };
    assert.equal(metricsDeviation.actualProgress, 25);
    assert.equal(metricsDeviation.plannedProgress, 25);
    assert.equal(metricsDeviation.spi, 1);
    const dashboardSummary = await (await fetch(`http://127.0.0.1:${address.port}/dashboard/summary`, {
      headers: { authorization },
    })).json() as { allProjects: Array<{ id: number; overallProgress: number; plannedProgress: number; spi: number | null }> };
    const dashboardMetrics = dashboardSummary.allProjects.find(project => project.id === metricsTargetProject.id)!;
    assert.equal(dashboardMetrics.overallProgress, 25);
    assert.equal(dashboardMetrics.plannedProgress, 25);
    assert.equal(dashboardMetrics.spi, 1);

    const weightedSummary = await (await fetch(
      `http://127.0.0.1:${address.port}/projects/${weightedProject.id}/summary`,
      { headers: { authorization } },
    )).json() as { overallProgress: number; plannedProgress: number; spi: number };
    assert.equal(weightedSummary.overallProgress, 45);
    assert.equal(weightedSummary.plannedProgress, 75);
    assert.equal(weightedSummary.spi, 0.6);
    const weightedDeviation = await (await fetch(
      `http://127.0.0.1:${address.port}/projects/${weightedProject.id}/deviation`,
      { headers: { authorization } },
    )).json() as { actualProgress: number; plannedProgress: number; spi: number };
    assert.equal(weightedDeviation.actualProgress, 45);
    assert.equal(weightedDeviation.plannedProgress, 75);
    assert.equal(weightedDeviation.spi, 0.6);
    const dashboardWeighted = dashboardSummary.allProjects.find(project => project.id === weightedProject.id)!;
    assert.equal(dashboardWeighted.overallProgress, 45);
    assert.equal(dashboardWeighted.plannedProgress, 75);
    assert.equal(dashboardWeighted.spi, 0.6);

    const noScheduleActivities = await (await fetch(apiBase, { headers: { authorization } }))
      .json() as Array<{ plannedProgress: number }>;
    assert.ok(noScheduleActivities.every(activity => activity.plannedProgress === 0));

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
    // real HTTP middleware, including target-tab ACLs and code-only linking.
    const [httpSource, httpSource2, httpTarget] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-http-source` },
      { ...base, name: `${suffix}-http-source-two` },
      { ...base, name: `${suffix}-http-target` },
    ]).returning();
    projectIds.push(httpSource.id, httpSource2.id, httpTarget.id);
    const httpAdminProjectsUrl = `http://127.0.0.1:${address.port}/projects/${httpSource.id}`;
    const setSourceCode = async (projectId: number, linkCode: unknown) => fetch(
      `http://127.0.0.1:${address.port}/projects/${projectId}`,
      {
        method: "PATCH", headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ linkCode }),
      },
    );
    assert.equal((await setSourceCode(httpSource.id, ` ${projectCodeOne.toLowerCase()} `)).status, 200);
    assert.equal((await setSourceCode(httpSource2.id, projectCodeTwo)).status, 200);
    assert.equal((await setSourceCode(httpSource2.id, projectCodeOne.toLowerCase())).status, 409);
    assert.equal((await setSourceCode(httpTarget.id, "bad!")).status, 400);
    assert.equal((await setSourceCode(httpTarget.id, temporaryTargetCode)).status, 200);
    const [demotedAdmin] = await db.insert(usersTable).values({
      phone: `${suffix}-demoted-admin`, passwordHash: "integration-test", fullName: "Demoted Admin", role: "admin",
    }).returning();
    userIds.push(demotedAdmin.id);
    const staleAdminAuth = `Bearer ${signToken({ userId: demotedAdmin.id, phone: demotedAdmin.phone, role: "admin" })}`;
    await db.update(usersTable).set({ role: "engineer" }).where(eq(usersTable.id, demotedAdmin.id));
    const demotedProjectRead = await fetch(httpAdminProjectsUrl, { headers: { authorization: staleAdminAuth } });
    assert.equal(demotedProjectRead.status, 403);
    assert.equal((await demotedProjectRead.text()).includes(projectCodeOne), false);
    const demotedCodeWrite = await fetch(httpAdminProjectsUrl, {
      method: "PATCH", headers: { authorization: staleAdminAuth, "content-type": "application/json" },
      body: JSON.stringify({ linkCode: `DEMOTED-${suffix.slice(-8)}-CODE` }),
    });
    assert.equal(demotedCodeWrite.status, 403);
    const [unchangedSource] = await db.select({ linkCode: projectsTable.linkCode }).from(projectsTable)
      .where(eq(projectsTable.id, httpSource.id));
    assert.equal(unchangedSource.linkCode, projectCodeOne);
    const adminProjectRead = await fetch(httpAdminProjectsUrl, { headers: { authorization } });
    assert.equal((await adminProjectRead.json() as { linkCode: string }).linkCode, projectCodeOne);
    const adminProjectList = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers: { authorization } });
    assert.equal(((await adminProjectList.json()) as Array<Record<string, unknown>>)
      .some(project => Object.hasOwn(project, "linkCode")), false);
    const targetGroupResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`, {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP target" }),
    });
    assert.equal(targetGroupResponse.status, 201);
    const httpTargetGroup = await targetGroupResponse.json() as { id: number };
    const targetGroupTwoResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP target two" }),
    });
    assert.equal(targetGroupTwoResponse.status, 201);
    const httpTargetGroupTwo = await targetGroupTwoResponse.json() as { id: number };
    const ordinaryGroupResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP ordinary target" }),
    });
    assert.equal(ordinaryGroupResponse.status, 201);
    const ordinaryTargetGroup = await ordinaryGroupResponse.json() as { id: number };

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
    const deniedCodeWrite = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}`, {
      method: "PATCH", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ linkCode: `${suffix}-not-allowed` }),
    });
    assert.equal(deniedCodeWrite.status, 403);
    const engineerProjectRead = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}`, {
      headers: { authorization: engineerAuth },
    });
    assert.equal(engineerProjectRead.status, 200);
    assert.equal(Object.hasOwn(await engineerProjectRead.json() as object, "linkCode"), false);
    const inaccessibleSourceRead = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource.id}`, {
      headers: { authorization: engineerAuth },
    });
    assert.equal(inaccessibleSourceRead.status, 403);
    const projectList = await fetch(`http://127.0.0.1:${address.port}/projects`, { headers: { authorization: engineerAuth } });
    const listedProjects = await projectList.json() as Array<Record<string, unknown>>;
    assert.equal(listedProjects.some(project => Object.hasOwn(project, "linkCode")), false);
    assert.equal(listedProjects.some(project => project.id === httpSource.id || project.id === httpSource2.id), false);
    const linkUrl = `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/linked-project`;
    const legacyNumericLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectId: httpSource.id }),
    });
    assert.equal(legacyNumericLink.status, 400);
    const invalidCodeLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectCode: wrongProjectCode }),
    });
    assert.equal(invalidCodeLink.status, 404);
    const invalidCodeBody = await invalidCodeLink.json() as { error: string };
    assert.match(invalidCodeBody.error, /رمز الربط المحدد/);
    const forbiddenSourceLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectCode: projectCodeOne }),
    });
    assert.equal(forbiddenSourceLink.status, 200);
    const forbiddenSourceBody = await forbiddenSourceLink.json() as { group: Record<string, unknown>; created: number };
    assert.equal(forbiddenSourceBody.group.linkedProjectActive, true);
    assert.equal(Object.hasOwn(forbiddenSourceBody.group, "linkedProjectId"), false);
    assert.equal(JSON.stringify(forbiddenSourceBody.group).includes(projectCodeOne), false);
    assert.equal(forbiddenSourceBody.created, 0);
    const viewerLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: viewerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectCode: projectCodeOne }),
    });
    assert.equal(viewerLink.status, 403);
    const secondLinkUrl = `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroupTwo.id}/linked-project`;
    const attachSecondProject = await fetch(secondLinkUrl, {
      method: "PUT", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectCode: projectCodeTwo }),
    });
    assert.equal(attachSecondProject.status, 200);
    assert.equal((await attachSecondProject.json() as { group: { linkedProjectActive: boolean } }).group.linkedProjectActive, true);
    const targetGroupsRead = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`, {
      headers: { authorization: engineerAuth },
    });
    const targetGroupsJson = await targetGroupsRead.json() as Array<Record<string, unknown>>;
    assert.equal(targetGroupsJson.length, 3);
    assert.equal(targetGroupsJson.filter(group => group.linkedProjectActive === true).length, 2);
    assert.equal(targetGroupsJson.some(group => Object.hasOwn(group, "linkedProjectId")), false);
    assert.equal(targetGroupsJson.some(group => group.id === ordinaryTargetGroup.id && group.linkedProjectActive !== false), false);
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
    const sourceGroupTwoResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource2.id}/activity-groups`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP source two group" }),
    });
    assert.equal(sourceGroupTwoResponse.status, 201);
    const httpSourceGroupTwo = await sourceGroupTwoResponse.json() as { id: number };
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
    const sourceActivityTwoResponse = await fetch(`http://127.0.0.1:${address.port}/projects/${httpSource2.id}/activities`, {
      method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        name: "HTTP source two activity", groupId: httpSourceGroupTwo.id,
        actualProgress: 35, plannedStartDate: "2026-03-01", plannedEndDate: "2026-04-01",
      }),
    });
    assert.equal(sourceActivityTwoResponse.status, 201);
    const materializedSync = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroup.id}/sync`, {
      method: "POST", headers: { authorization },
    });
    assert.equal(materializedSync.status, 200);
    const materializedSyncBody = await materializedSync.json() as { created: number; updated: number };
    assert.equal(materializedSyncBody.created, 0);
    assert.equal(materializedSyncBody.updated, 0);
    const materializedSecondSync = await fetch(`http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups/${httpTargetGroupTwo.id}/sync`, {
      method: "POST", headers: { authorization: engineerAuth },
    });
    assert.equal(materializedSecondSync.status, 200);
    assert.equal((await materializedSecondSync.json() as { created: number }).created, 0);
    const httpActivitiesUrl = `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activities`;
    let httpActivities = await fetch(httpActivitiesUrl, { headers: { authorization: engineerAuth } });
    assert.equal(httpActivities.status, 200);
    const httpActivityRows = await httpActivities.json() as Array<{
      id: number; actualProgress: number; externalSource?: Record<string, unknown>;
    }>;
    const generatedHttpActivity = httpActivityRows.find(activity => activity.id === httpManaged[0].id)!;
    assert.equal(generatedHttpActivity.actualProgress, 75);
    assert.equal(generatedHttpActivity.externalSource?.available, true);
    assert.equal(generatedHttpActivity.externalSource?.groupName, "HTTP source group");
    assert.equal(Object.hasOwn(generatedHttpActivity.externalSource!, "projectName"), false);
    assert.equal(Object.hasOwn(generatedHttpActivity.externalSource!, "linkCode"), false);
    assert.equal(Object.hasOwn(generatedHttpActivity.externalSource!, "projectId"), false);
    assert.equal(Object.hasOwn(generatedHttpActivity.externalSource!, "groupId"), false);
    assert.equal(JSON.stringify(generatedHttpActivity.externalSource).includes(projectCodeOne), false);
    assert.equal(Object.hasOwn(generatedHttpActivity, "externalSourceGroupId"), false);
    assert.equal(Object.hasOwn(generatedHttpActivity, "managedSourceProjectId"), false);
    const [httpManagedTwo] = await db.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, httpTargetGroupTwo.id));
    assert.equal(httpManagedTwo.externalSourceGroupId, httpSourceGroupTwo.id);
    assert.equal(httpManagedTwo.actualProgress, 35);
    const targetOnlyMutation = await fetch(`${httpActivitiesUrl}/${httpManaged[0].id}`, {
      method: "PATCH", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ weight: 2 }),
    });
    assert.equal(targetOnlyMutation.status, 200);
    const targetOnlyMutationBody = await targetOnlyMutation.json() as Record<string, unknown>;
    assert.equal(Object.hasOwn(targetOnlyMutationBody, "externalSourceGroupId"), false);
    assert.equal(Object.hasOwn(targetOnlyMutationBody, "managedSourceProjectId"), false);
    assert.equal((targetOnlyMutationBody.externalSource as Record<string, unknown>).groupName, "HTTP source group");
    const sourceAuthorizedMutation = await fetch(`${httpActivitiesUrl}/${httpManaged[0].id}`, {
      method: "PATCH", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ weight: 1 }),
    });
    assert.equal(sourceAuthorizedMutation.status, 200);
    const sourceAuthorizedMutationBody = await sourceAuthorizedMutation.json() as Record<string, unknown>;
    assert.equal(sourceAuthorizedMutationBody.externalSourceGroupId, httpSourceGroup.id);
    assert.equal(sourceAuthorizedMutationBody.managedSourceProjectId, httpSource.id);
    const ownerToken = `owner-${suffix.slice(-8)}`;
    await db.update(projectsTable).set({ ownerAccessToken: ownerToken, ownerAccessPassword: null })
      .where(eq(projectsTable.id, httpTarget.id));
    const ownerVerifyResponse = await fetch(`http://127.0.0.1:${address.port}/owner/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: ownerToken }),
    });
    assert.equal(ownerVerifyResponse.status, 200);
    const ownerVerify = await ownerVerifyResponse.json() as {
      ownerJwt: string; project: Record<string, unknown>; activities: Array<Record<string, unknown>>;
    };
    assert.equal(Object.hasOwn(ownerVerify.project, "linkCode"), false);
    assert.equal(ownerVerify.activities.some(activity =>
      Object.hasOwn(activity, "externalSourceGroupId") || Object.hasOwn(activity, "managedSourceProjectId")), false);
    const ownerDataResponse = await fetch(`http://127.0.0.1:${address.port}/owner/${ownerToken}/data`, {
      headers: { authorization: `Bearer ${ownerVerify.ownerJwt}` },
    });
    assert.equal(ownerDataResponse.status, 200);
    const ownerData = await ownerDataResponse.json() as {
      project: Record<string, unknown>; activities: Array<Record<string, unknown>>;
    };
    assert.equal(Object.hasOwn(ownerData.project, "linkCode"), false);
    assert.equal(ownerData.activities.some(activity =>
      Object.hasOwn(activity, "externalSourceGroupId") || Object.hasOwn(activity, "managedSourceProjectId")), false);
    assert.equal((await setSourceCode(httpTarget.id, null)).status, 200);
    const [httpTargetProgress] = await db.select({ overallProgress: projectsTable.overallProgress })
      .from(projectsTable).where(eq(projectsTable.id, httpTarget.id));
    assert.equal(httpTargetProgress.overallProgress, 55);

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
    httpActivities = await fetch(httpActivitiesUrl, { headers: { authorization: engineerAuth } });
    const unavailableRows = await httpActivities.json() as Array<{
      id: number; actualProgress: number; externalSource?: Record<string, unknown>;
    }>;
    const unavailableActivity = unavailableRows.find(activity => activity.id === httpManaged[0].id)!;
    assert.equal(unavailableActivity.externalSource?.available, false);
    assert.equal(Object.hasOwn(unavailableActivity.externalSource!, "groupId"), false);
    assert.equal(unavailableActivity.actualProgress, snapshotBeforeUnavailable.actualProgress);
    const detachHttpLink = await fetch(linkUrl, {
      method: "PUT", headers: { authorization: engineerAuth, "content-type": "application/json" },
      body: JSON.stringify({ sourceProjectCode: null }),
    });
    assert.equal(detachHttpLink.status, 200);
    assert.equal((await detachHttpLink.json() as { group: { linkedProjectActive: boolean } }).group.linkedProjectActive, false);
    const groupsAfterIndependentDetach = await (await fetch(
      `http://127.0.0.1:${address.port}/projects/${httpTarget.id}/activity-groups`,
      { headers: { authorization: engineerAuth } },
    )).json() as Array<{ id: number; linkedProjectActive: boolean }>;
    assert.equal(groupsAfterIndependentDetach.find(group => group.id === httpTargetGroupTwo.id)?.linkedProjectActive, true);
    assert.equal(groupsAfterIndependentDetach.find(group => group.id === ordinaryTargetGroup.id)?.linkedProjectActive, false);

    // Code rotation and attach share the graph lock. Start both operations
    // concurrently in each order to prove an old code cannot win after rotation.
    const [rotateFirstSource, rotateFirstTarget, attachFirstSource, attachFirstTarget] = await db.insert(projectsTable).values([
      { ...base, name: `${suffix}-rotate-first-source`, linkCode: `ROTATE-${suffix.slice(-8)}-OLD` },
      { ...base, name: `${suffix}-rotate-first-target` },
      { ...base, name: `${suffix}-attach-first-source`, linkCode: `ATTACH-${suffix.slice(-8)}-OLD` },
      { ...base, name: `${suffix}-attach-first-target` },
    ]).returning();
    projectIds.push(rotateFirstSource.id, rotateFirstTarget.id, attachFirstSource.id, attachFirstTarget.id);
    const [rotateFirstGroup, attachFirstGroup] = await db.insert(activityGroupsTable).values([
      { projectId: rotateFirstTarget.id, name: "Rotate-first target" },
      { projectId: attachFirstTarget.id, name: "Attach-first target" },
    ]).returning();
    const rotateFirstCode = `ROTATE-${suffix.slice(-8)}-OLD`;
    const attachFirstCode = `ATTACH-${suffix.slice(-8)}-OLD`;
    const rotateFirstTask = withSourceGraphLock(async () => {
      await db.update(projectsTable).set({ linkCode: `ROTATE-${suffix.slice(-8)}-NEW` })
        .where(eq(projectsTable.id, rotateFirstSource.id));
    });
    const staleAttachTask = withSourceGraphLock(() =>
      reconcileGroupToSideProject(rotateFirstGroup.id, rotateFirstSource.id, true, undefined, rotateFirstCode),
    );
    const [, staleAttachResult] = await Promise.all([rotateFirstTask, staleAttachTask]);
    assert.equal(staleAttachResult.conflict, "code_changed");
    assert.equal(staleAttachResult.group?.linkedProjectId, null);

    const validAttachTask = withSourceGraphLock(() =>
      reconcileGroupToSideProject(attachFirstGroup.id, attachFirstSource.id, true, undefined, attachFirstCode),
    );
    const rotateAfterAttachTask = withSourceGraphLock(async () => {
      await db.update(projectsTable).set({ linkCode: `ATTACH-${suffix.slice(-8)}-NEW` })
        .where(eq(projectsTable.id, attachFirstSource.id));
    });
    const [validAttachResult] = await Promise.all([validAttachTask, rotateAfterAttachTask]);
    assert.equal(validAttachResult.conflict, undefined);
    assert.equal(validAttachResult.group?.linkedProjectId, attachFirstSource.id);

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