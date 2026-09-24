import { db, pool, activitiesTable, activityGroupsTable, projectsTable, projectMembersTable, userCompaniesTable, usersTable } from "@workspace/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { recalcExpectedEndDate } from "./recalc-end-date";
import { calcActivityPlannedProgress, roundPercent } from "./progress";
import {
  currentRoleCanReadProject,
  linkedActivityValues,
  normalizeLinkCode,
  summarizeSourceChildren,
  topologicalSourceGroupOrder,
  wouldCreateDependencyCycle,
} from "./activity-source-rules";

export { normalizeLinkCode } from "./activity-source-rules";

let processGraphLock = Promise.resolve();

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
      const result = await operation();
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
  const sourceGroups = await db.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId }).from(activityGroupsTable);
  const projectForGroup = new Map(sourceGroups.map(g => [g.id, g.projectId]));
  const edges = new Map<number, number[]>();
  for (const link of linked) {
    if (link.sourceGroupId == null) continue;
    const source = projectForGroup.get(link.sourceGroupId);
    if (source === undefined) continue;
    edges.set(link.projectId, [...(edges.get(link.projectId) ?? []), source]);
  }
  return wouldCreateDependencyCycle(targetProjectId, sourceProjectId, edges);
}

/** Recompute every target activity linked to a source group and propagate downstream, without recursive call stacks. */
export async function refreshLinkedSources(sourceGroupIds: number[]) {
  if (!sourceGroupIds.length) return;
  await withSourceGraphLock(async () => {
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