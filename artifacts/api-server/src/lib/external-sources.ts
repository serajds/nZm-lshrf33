import { db, pool, activitiesTable, activityGroupsTable, projectsTable, projectExtensionsTable, projectMembersTable, projectFilesTable, reportsTable, userCompaniesTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull, isNull, max, sum } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { recalcExpectedEndDate } from "./recalc-end-date";
import { calcActivityPlannedProgress, roundPercent } from "./progress";
import {
  currentRoleCanReadProject,
  linkedActivityValues,
  normalizeLinkCode,
  normalizeProjectLinkCode,
  summarizeSourceChildren,
  topologicalSourceGroupOrder,
  wouldCreateDependencyCycle,
} from "./activity-source-rules";

export { normalizeLinkCode } from "./activity-source-rules";

let processGraphLock = Promise.resolve();
const graphLockContext = new AsyncLocalStorage<boolean>();

export async function canReadProject(userId: number, projectId: number): Promise<boolean> {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return false;
  const [membership] = await db.select({ id: projectMembersTable.id }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.userId, userId), eq(projectMembersTable.projectId, projectId)));
  const companies = await db.select({ companyId: userCompaniesTable.companyId }).from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId));
  const [project] = await db.select({ contractorCompanyId: projectsTable.contractorCompanyId }).from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  return currentRoleCanReadProject(
    user.role,
    Boolean(membership),
    project?.contractorCompanyId ?? null,
    companies.map(company => company.companyId),
  );
}

/** Serialize graph mutations and propagation; the lock is shared across API instances via PostgreSQL. */
export async function withSourceGraphLock<T>(operation: () => Promise<T>): Promise<T> {
  if (graphLockContext.getStore()) return operation();
  const previous = processGraphLock;
  let releaseProcessLock!: () => void;
  processGraphLock = new Promise<void>(resolve => {
    releaseProcessLock = resolve;
  });
  await previous;
  try {
    const client = await pool.connect();
    const lockKey = 731924613;
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
      const result = await graphLockContext.run(true, operation);
      await client.query("COMMIT");
      transactionOpen = false;
      return result;
    } finally {
      try {
        if (transactionOpen) await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
  } finally {
    releaseProcessLock();
  }
}

function managedStatus(progress: number): "not_started" | "in_progress" | "completed" {
  return progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "not_started";
}

async function recalculateProjectInTransaction(tx: any, projectId: number) {
  const acts = await tx.select({ actualProgress: activitiesTable.actualProgress, weight: activitiesTable.weight })
    .from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  let totalWeight = 0;
  let weightedProgress = 0;
  for (const activity of acts as { actualProgress: number; weight: number }[]) {
    const weight = activity.weight > 0 ? activity.weight : 1;
    totalWeight += weight;
    weightedProgress += activity.actualProgress * weight;
  }
  const progress = totalWeight ? roundPercent(weightedProgress / totalWeight) : 0;
  await tx.update(projectsTable).set({ overallProgress: progress }).where(eq(projectsTable.id, projectId));

  const [project] = await tx.select({ noSchedule: projectsTable.noSchedule })
    .from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project?.noSchedule) return;
  const [endResult] = await tx.select({ endDate: max(activitiesTable.plannedEndDate) })
    .from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  if (!endResult?.endDate) return;
  const [extensions] = await tx.select({ days: sum(projectExtensionsTable.daysAdded) })
    .from(projectExtensionsTable).where(eq(projectExtensionsTable.projectId, projectId));
  const extensionDays = extensions?.days ? Number(extensions.days) : 0;
  const days = extensionDays > 0 ? extensionDays : 0;
  const end = new Date(`${endResult.endDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  await tx.update(projectsTable).set({ expectedEndDate: end.toISOString().slice(0, 10) })
    .where(eq(projectsTable.id, projectId));
}

/**
 * Reconcile one target group's managed activity snapshot against every current
 * group in the selected source project. Existing rows for deleted source groups
 * deliberately remain as their last-known snapshot.
 */
export async function reconcileGroupToSideProject(
  targetGroupId: number,
  sourceProjectId: number | null,
  propagate = true,
  expectedCurrentSourceProjectId?: number,
  expectedSourceProjectCode?: string,
): Promise<{ group: typeof activityGroupsTable.$inferSelect | undefined; created: number; updated: number; unavailable: number; conflict?: string }> {
  let result: { group: typeof activityGroupsTable.$inferSelect | undefined; created: number; updated: number; unavailable: number; conflict?: string };
  const propagatedGroupIds = new Set<number>();
  result = await withSourceGraphLock(async () => db.transaction(async tx => {
    const [targetGroup] = await tx.select().from(activityGroupsTable).where(eq(activityGroupsTable.id, targetGroupId));
    if (!targetGroup) return { group: undefined, created: 0, updated: 0, unavailable: 0 };
    if (expectedCurrentSourceProjectId !== undefined
        && targetGroup.linkedProjectId !== expectedCurrentSourceProjectId) {
      return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "link_changed" };
    }
    const managed = await tx.select().from(activitiesTable).where(eq(activitiesTable.managedByGroupId, targetGroupId));
    if (sourceProjectId == null) {
      const [group] = await tx.update(activityGroupsTable).set({ linkedProjectId: null })
        .where(eq(activityGroupsTable.id, targetGroupId)).returning();
      return { group, created: 0, updated: 0, unavailable: 0 };
    }

    if (targetGroup.linkedProjectId != null && targetGroup.linkedProjectId !== sourceProjectId && managed.length) {
      return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "managed_rows_remain" };
    }
    if (managed.some(item => item.managedSourceProjectId != null
        && item.managedSourceProjectId !== sourceProjectId)) {
      return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "managed_rows_remain" };
    }
    const [sourceProject] = await tx.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, sourceProjectId));
    if (!sourceProject) return {
      group: targetGroup,
      created: 0,
      updated: 0,
      unavailable: managed.length,
      conflict: "source_missing",
    };
    if (expectedSourceProjectCode !== undefined) {
      const [sourceWithCode] = await tx.select({ linkCode: projectsTable.linkCode }).from(projectsTable)
        .where(eq(projectsTable.id, sourceProjectId));
      if (normalizeProjectLinkCode(sourceWithCode?.linkCode) !== expectedSourceProjectCode) {
        return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "code_changed" };
      }
    }
    const sourceGroups = await tx.select().from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, sourceProjectId));
    if (await wouldCreateSourceCycle(targetGroup.projectId, sourceProjectId)) {
      return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "cycle" };
    }
    const manualLinks = await tx.select().from(activitiesTable).where(and(
      eq(activitiesTable.groupId, targetGroupId),
      isNotNull(activitiesTable.externalSourceGroupId),
      isNull(activitiesTable.managedByGroupId),
    ));
    const sourceGroupIds = new Set(sourceGroups.map(group => group.id));
    if (manualLinks.some(item => item.managedByGroupId == null && item.externalSourceGroupId != null
      && sourceGroupIds.has(item.externalSourceGroupId))) {
      return { group: targetGroup, created: 0, updated: 0, unavailable: 0, conflict: "manual_duplicate" };
    }

    const existingBySource = new Map(managed
      .filter(item => item.externalSourceGroupId != null)
      .map(item => [item.externalSourceGroupId!, item]));
    const summaries = await Promise.all(sourceGroups.map(source => getGroupSummary(source.id)));
    let created = 0;
    let updated = 0;
    const [maxSort] = await tx.select({ value: max(activitiesTable.sortOrder) }).from(activitiesTable)
      .where(eq(activitiesTable.projectId, targetGroup.projectId));
    let sortOrder = (maxSort?.value ?? 0) + 1;
    const now = new Date();
    for (const summary of summaries) {
      if (!summary) continue;
      const plannedProgress = calcActivityPlannedProgress({
        plannedStartDate: summary.plannedStartDate,
        plannedEndDate: summary.plannedEndDate,
      });
      const status = managedStatus(summary.actualProgress);
      const prior = existingBySource.get(summary.groupId);
      if (!prior) {
        await tx.insert(activitiesTable).values({
          projectId: targetGroup.projectId,
          groupId: targetGroupId,
          externalSourceGroupId: summary.groupId,
          managedByGroupId: targetGroupId,
          managedSourceProjectId: sourceProjectId,
          name: summary.groupName,
          actualProgress: summary.actualProgress,
          plannedStartDate: summary.plannedStartDate,
          plannedEndDate: summary.plannedEndDate,
          plannedProgress: roundPercent(plannedProgress),
          status,
          progressUpdatedAt: summary.actualProgress > 0 ? now : null,
          sortOrder: sortOrder++,
        });
        created++;
        continue;
      }
      const mappedChanged = prior.name !== summary.groupName
        || prior.actualProgress !== summary.actualProgress
        || prior.plannedStartDate !== summary.plannedStartDate
        || prior.plannedEndDate !== summary.plannedEndDate
        || prior.plannedProgress !== roundPercent(plannedProgress)
        || prior.status !== status;
      if (!mappedChanged) continue;
      await tx.update(activitiesTable).set({
        name: summary.groupName,
        actualProgress: summary.actualProgress,
        plannedStartDate: summary.plannedStartDate,
        plannedEndDate: summary.plannedEndDate,
        plannedProgress: roundPercent(plannedProgress),
        status,
        managedSourceProjectId: sourceProjectId,
        ...((prior.actualProgress !== summary.actualProgress || prior.status !== status) ? { progressUpdatedAt: now } : {}),
      }).where(eq(activitiesTable.id, prior.id));
      updated++;
    }
    const [group] = await tx.update(activityGroupsTable).set({ linkedProjectId: sourceProjectId })
      .where(eq(activityGroupsTable.id, targetGroupId)).returning();
    propagatedGroupIds.add(targetGroupId);
    await recalculateProjectInTransaction(tx, targetGroup.projectId);
    const unavailable = managed.filter(item => item.externalSourceGroupId == null
      || !sourceGroupIds.has(item.externalSourceGroupId)).length;
    return { group, created, updated, unavailable };
  }));
  // Propagation is intentionally outside the database transaction and graph-lock
  // callback. One refresh pass updates downstream consumers of this target group.
  if (propagate && propagatedGroupIds.size) await refreshLinkedSources([...propagatedGroupIds]);
  return result;
}

/** Sync all target groups subscribed to a source project after source group changes. */
export async function reconcileTargetsLinkedToProject(sourceProjectId: number) {
  const targets = await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
    .where(eq(activityGroupsTable.linkedProjectId, sourceProjectId));
  let created = 0;
  let updated = 0;
  let unavailable = 0;
  const downstream: number[] = [];
  for (const target of targets) {
    const result = await reconcileGroupToSideProject(target.id, sourceProjectId, false, sourceProjectId);
    if (result.conflict === "link_changed") continue;
    created += result.created;
    updated += result.updated;
    unavailable += result.unavailable;
    if (result.group) downstream.push(result.group.id);
  }
  if (downstream.length) await refreshLinkedSources(downstream);
  return { created, updated, unavailable };
}

/** Delete a project graph atomically with respect to all source-graph mutations. */
export async function deleteProjectUnderSourceGraphLock(projectId: number) {
  return withSourceGraphLock(async () => db.transaction(async tx => {
    const [project] = await tx.select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return undefined;
    await tx.delete(projectMembersTable).where(eq(projectMembersTable.projectId, projectId));
    await tx.delete(activitiesTable).where(eq(activitiesTable.projectId, projectId));
    // Stable external source IDs in other projects intentionally remain so
    // subscribers retain their snapshots and can report the source unavailable.
    await tx.delete(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
    await tx.delete(reportsTable).where(eq(reportsTable.projectId, projectId));
    await tx.delete(projectFilesTable).where(eq(projectFilesTable.projectId, projectId));
    await tx.delete(projectsTable).where(eq(projectsTable.id, projectId));
    return project;
  }));
}

/** Create a group atomically against concurrent project deletion. */
export async function createActivityGroupUnderSourceGraphLock(
  projectId: number,
  values: { name: string; color: string; linkCode: string | null },
) {
  return withSourceGraphLock(async () => db.transaction(async tx => {
    const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (!project) return undefined;
    const groups = await tx.select({ sortOrder: activityGroupsTable.sortOrder }).from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, projectId));
    const maxSort = groups.reduce((value, group) => Math.max(value, group.sortOrder), 0);
    const [created] = await tx.insert(activityGroupsTable).values({
      projectId,
      ...values,
      sortOrder: maxSort + 1,
    }).returning();
    return created;
  }));
}

export async function getGroupSummary(groupId: number) {
  const [group] = await db.select().from(activityGroupsTable).where(eq(activityGroupsTable.id, groupId));
  if (!group) return null;
  const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, group.projectId));
  if (!project) return null;
  const children = await db.select({
    actualProgress: activitiesTable.actualProgress,
    weight: activitiesTable.weight,
    plannedStartDate: activitiesTable.plannedStartDate,
    plannedEndDate: activitiesTable.plannedEndDate,
  }).from(activitiesTable).where(and(eq(activitiesTable.projectId, group.projectId), eq(activitiesTable.groupId, groupId)));
  return summarizeSourceChildren(children, {
    groupId: group.id,
    projectId: group.projectId,
    projectName: project.name,
    groupName: group.name,
    linkCode: group.linkCode,
  });
}

/** The dependency graph is target project -> source project. Adding an edge is safe only if source cannot already reach target. */
export async function wouldCreateSourceCycle(targetProjectId: number, sourceProjectId: number): Promise<boolean> {
  if (targetProjectId === sourceProjectId) return true;
  const linked = await db.select({
    projectId: activitiesTable.projectId,
    sourceGroupId: activitiesTable.externalSourceGroupId,
  }).from(activitiesTable).where(isNotNull(activitiesTable.externalSourceGroupId));
  const sourceGroups = await db.select({
    id: activityGroupsTable.id,
    projectId: activityGroupsTable.projectId,
    linkedProjectId: activityGroupsTable.linkedProjectId,
  }).from(activityGroupsTable);
  const projectForGroup = new Map(sourceGroups.map(g => [g.id, g.projectId]));
  const edges = new Map<number, number[]>();
  // Declared project-level subscriptions form graph edges even before either
  // project has source groups or managed activity snapshots.
  for (const group of sourceGroups) {
    if (group.linkedProjectId == null) continue;
    edges.set(group.projectId, [...(edges.get(group.projectId) ?? []), group.linkedProjectId]);
  }
  for (const link of linked) {
    if (link.sourceGroupId == null) continue;
    const source = projectForGroup.get(link.sourceGroupId);
    if (source === undefined) continue;
    edges.set(link.projectId, [...(edges.get(link.projectId) ?? []), source]);
  }
  return wouldCreateDependencyCycle(targetProjectId, sourceProjectId, edges);
}

/** True when an active side-project group already represents this source group. */
export async function hasLinkedGroupSourceDuplicate(
  queryable: any,
  targetGroupId: number,
  sourceGroupId: number,
  exceptActivityId?: number,
): Promise<boolean> {
  const [targetGroup] = await queryable.select({
    linkedProjectId: activityGroupsTable.linkedProjectId,
  }).from(activityGroupsTable).where(eq(activityGroupsTable.id, targetGroupId));
  if (targetGroup?.linkedProjectId == null) return false;
  const [sourceGroup] = await queryable.select({ projectId: activityGroupsTable.projectId })
    .from(activityGroupsTable).where(eq(activityGroupsTable.id, sourceGroupId));
  if (sourceGroup?.projectId !== targetGroup.linkedProjectId) return false;
  const represented = await queryable.select({ id: activitiesTable.id }).from(activitiesTable).where(and(
    eq(activitiesTable.groupId, targetGroupId),
    eq(activitiesTable.externalSourceGroupId, sourceGroupId),
  ));
  return represented.some((activity: { id: number }) => activity.id !== exceptActivityId);
}

/** Recompute every target activity linked to a source group and propagate downstream, without recursive call stacks. */
export async function refreshLinkedSources(sourceGroupIds: number[]) {
  if (!sourceGroupIds.length) return;
  await withSourceGraphLock(async () => {
    const managedGroups = await db.select({
      id: activityGroupsTable.id,
      projectId: activityGroupsTable.projectId,
      linkedProjectId: activityGroupsTable.linkedProjectId,
    }).from(activityGroupsTable);
    const managedGroupById = new Map(managedGroups.map(group => [group.id, group]));
    const linkedActivities = await db.select({
      sourceGroupId: activitiesTable.externalSourceGroupId,
      targetGroupId: activitiesTable.groupId,
    }).from(activitiesTable).where(and(
      isNotNull(activitiesTable.externalSourceGroupId),
      isNotNull(activitiesTable.groupId),
    ));
    const dependencies = new Map<number, number[]>();
    for (const linked of linkedActivities) {
      if (linked.sourceGroupId == null || linked.targetGroupId == null) continue;
      dependencies.set(linked.sourceGroupId, [...(dependencies.get(linked.sourceGroupId) ?? []), linked.targetGroupId]);
    }
    const order = topologicalSourceGroupOrder(sourceGroupIds, dependencies);
    for (const groupId of order) {
      const summary = await getGroupSummary(groupId);
      if (!summary) continue; // Preserve last values when a group/project has been deleted.
      const targets = await db.select().from(activitiesTable).where(eq(activitiesTable.externalSourceGroupId, groupId));
      const projects = new Set<number>();
      for (const activity of targets) {
        if (activity.managedByGroupId != null) {
          const ownerGroup = managedGroupById.get(activity.managedByGroupId);
          const activeManagedGroup = ownerGroup?.linkedProjectId === summary.projectId;
          // Detach freezes the generated group label and restores ordinary
          // activity status edits, but the retained external group ID continues
          // to refresh this activity's individual progress and planned dates.
          const values = linkedActivityValues(summary, calcActivityPlannedProgress({
            plannedStartDate: summary.plannedStartDate,
            plannedEndDate: summary.plannedEndDate,
          }));
          if (!values) continue;
          const status = managedStatus(summary.actualProgress);
          const executionStateChanged = activity.actualProgress !== summary.actualProgress
            || (activeManagedGroup && activity.status !== status);
          await db.update(activitiesTable).set({
            ...values,
            ...(activeManagedGroup ? { name: summary.groupName } : {}),
            ...(activeManagedGroup ? { status } : {}),
            ...(executionStateChanged ? { progressUpdatedAt: new Date() } : {}),
          }).where(eq(activitiesTable.id, activity.id));
          projects.add(activity.projectId);
          continue;
        }
        const plannedProgress = calcActivityPlannedProgress({
          plannedStartDate: summary.plannedStartDate,
          plannedEndDate: summary.plannedEndDate,
        });
        const values = linkedActivityValues(summary, plannedProgress);
        if (!values) continue;
        await db.update(activitiesTable).set({
          ...values,
          ...(activity.actualProgress !== summary.actualProgress ? { progressUpdatedAt: new Date() } : {}),
        }).where(eq(activitiesTable.id, activity.id));
        projects.add(activity.projectId);
      }
      for (const projectId of projects) {
        const acts = await db.select({ actualProgress: activitiesTable.actualProgress, weight: activitiesTable.weight }).from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
        const total = acts.reduce((s, a) => s + (a.weight > 0 ? a.weight : 1), 0);
        const progress = total ? roundPercent(acts.reduce((s, a) => s + a.actualProgress * (a.weight > 0 ? a.weight : 1), 0) / total) : 0;
        await db.update(projectsTable).set({ overallProgress: progress }).where(eq(projectsTable.id, projectId));
        await recalcExpectedEndDate(projectId);
      }
    }
  });
}