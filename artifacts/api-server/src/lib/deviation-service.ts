import { db, projectsTable, activitiesTable, activityGroupsTable, projectSuspensionsTable, reportsTable } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import { canReadProject } from "./external-sources";
import { loadEffectiveTabPermissions } from "../middlewares/tab-access";
import { analyzeActivities, analyzeSuspensions, analyzeTime, deviationStatus, type AnalysisGraph } from "./deviation-analysis";
import { buildDeviationHistory } from "./deviation-history";
import { utcDay, type PlannedCurve } from "./progress";

/** Breadth-first, batched reads of reachable source groups only. Portfolio children are irrelevant. */
export async function loadDeviationGraph(projectId: number): Promise<AnalysisGraph> {
  const [activities, groups, projects] = await Promise.all([
    db.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId))
      .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id)),
    db.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId, name: activityGroupsTable.name })
      .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId)),
    db.select().from(projectsTable).where(eq(projectsTable.id, projectId)),
  ]);
  const graph: AnalysisGraph = { activities, groups, projects };
  const seen = new Set<number>();
  let pending = activities.flatMap(a => a.externalSourceGroupId == null ? [] : [a.externalSourceGroupId]);
  const knownProjects = new Set(projects.map(p => p.id));
  while (pending.length) {
    const ids = [...new Set(pending)].filter(id => !seen.has(id));
    if (!ids.length) break;
    ids.forEach(id => seen.add(id));
    const [sourceGroups, sourceRows] = await Promise.all([
      db.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId, name: activityGroupsTable.name })
        .from(activityGroupsTable).where(inArray(activityGroupsTable.id, ids)),
      db.select().from(activitiesTable).where(inArray(activitiesTable.groupId, ids))
        .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id)),
    ]);
    const projectIds = [...new Set(sourceGroups.map(g => g.projectId))].filter(id => !knownProjects.has(id));
    if (projectIds.length) {
      graph.projects.push(...await db.select().from(projectsTable).where(inArray(projectsTable.id, projectIds)));
      projectIds.forEach(id => knownProjects.add(id));
    }
    const knownGroups = new Set(graph.groups.map(g => g.id));
    graph.groups.push(...sourceGroups.filter(g => !knownGroups.has(g.id)));
    const knownRows = new Set(graph.activities.map(a => a.id));
    graph.activities.push(...sourceRows.filter(a => !knownRows.has(a.id)));
    pending = sourceRows.flatMap(a => a.externalSourceGroupId == null ? [] : [a.externalSourceGroupId]);
  }
  return graph;
}

export async function getDeviationAnalysis(projectId: number, userId: number, curve: PlannedCurve) {
  const graph = await loadDeviationGraph(projectId);
  const project = graph.projects.find(p => p.id === projectId);
  if (!project) return null;
  const asOf = utcDay(new Date());
  const readable = new Set<number>();
  await Promise.all(graph.projects.map(async p => {
    if (await canReadProject(userId, p.id)) {
      const access = await loadEffectiveTabPermissions(userId, p.id);
      if (access && access.effective.activities !== "hidden") readable.add(p.id);
    }
  }));
  const result = analyzeActivities(project, graph, readable, asOf, curve);
  const suspensions = await db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));
  const suspensionMetrics = analyzeSuspensions(suspensions,
    project.noSchedule ? null : project.startDate, project.expectedEndDate, asOf);
  return {
    projectId, noSchedule: project.noSchedule, asOfDate: asOf.toISOString().slice(0, 10),
    ...result, ...analyzeTime(project, result.plannedProgress, result.actualProgress, asOf, result.dataStatus === "stale"),
    ...suspensionMetrics, currentEndDate: project.expectedEndDate,
    contractEndDate: project.expectedEndDate, roundingTolerance: 0.01,
    status: deviationStatus(result.progressDeviation), recommendations: [],
  };
}

export async function getDeviationTimeline(projectId: number, userId: number, curve: PlannedCurve) {
  const analysis = await getDeviationAnalysis(projectId, userId, curve);
  if (!analysis) return null;
  const permission = await loadEffectiveTabPermissions(userId, projectId);
  const reports = permission && permission.effective.reports !== "hidden"
    ? await db.select().from(reportsTable).where(eq(reportsTable.projectId, projectId)) : [];
  return { projectId, noSchedule: analysis.noSchedule, suspensionsBreakdown: analysis.suspensionsBreakdown,
    points: buildDeviationHistory(reports, {
      date: analysis.asOfDate, plannedProgress: analysis.plannedProgress, actualProgress: analysis.actualProgress,
      deviation: analysis.progressDeviation, kind: "live", reportId: null,
      baselineStatus: analysis.dataStatus === "stale" ? "stale" : analysis.scheduleStatus,
    }) };
}
