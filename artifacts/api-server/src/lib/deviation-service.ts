import { db, projectsTable, activitiesTable, activityGroupsTable, projectSuspensionsTable, reportsTable, projectFilesTable, projectExtensionsTable } from "@workspace/db";
import { asc, eq, inArray, count, sum } from "drizzle-orm";
import { loadEffectiveTabPermissions, loadProjectVisibilityForUser } from "../middlewares/tab-access";
import { analyzeActivities, analyzeSuspensions, analyzeTime, deviationStatus, type AnalysisGraph } from "./deviation-analysis";
import { buildDeviationHistory } from "./deviation-history";
import { utcDay, type PlannedCurve } from "./progress";

/** Breadth-first, batched reads of reachable source groups only. Portfolio children are irrelevant. */
export async function loadDeviationGraph(projectId: number, reader: Pick<typeof db, "select"> = db): Promise<AnalysisGraph> {
  // Transactions own one pg client; concurrent queries on it are deprecated by pg.
  const activities = await reader.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId))
    .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id));
  const groups = await reader.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId, name: activityGroupsTable.name })
    .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId));
  const projects = await reader.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const graph: AnalysisGraph = { activities, groups, projects };
  const seen = new Set<number>();
  let pending = activities.flatMap(a => a.externalSourceGroupId == null ? [] : [a.externalSourceGroupId]);
  const knownProjects = new Set(projects.map(p => p.id));
  while (pending.length) {
    const ids = [...new Set(pending)].filter(id => !seen.has(id));
    if (!ids.length) break;
    ids.forEach(id => seen.add(id));
    const sourceGroups = await reader.select({ id: activityGroupsTable.id, projectId: activityGroupsTable.projectId, name: activityGroupsTable.name })
      .from(activityGroupsTable).where(inArray(activityGroupsTable.id, ids));
    const sourceRows = await reader.select().from(activitiesTable).where(inArray(activitiesTable.groupId, ids))
      .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id));
    const projectIds = [...new Set(sourceGroups.map(g => g.projectId))].filter(id => !knownProjects.has(id));
    if (projectIds.length) {
      graph.projects.push(...await reader.select().from(projectsTable).where(inArray(projectsTable.id, projectIds)));
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

export async function getProjectAnalysisSnapshot(projectId: number, userId: number, curve: PlannedCurve = "linear") {
 return db.transaction(async tx => {
  const graph = await loadDeviationGraph(projectId, tx);
  const project = graph.projects.find(p => p.id === projectId);
  if (!project) return null;
  const asOf = utcDay(new Date());
   const visibility = await loadProjectVisibilityForUser(userId, graph.projects.map(p => p.id));
   const readable = new Set(graph.projects
     .filter(project => visibility.get(project.id)?.activitiesVisible)
     .map(project => project.id));
  const result = analyzeActivities(project, graph, readable, asOf, curve);
  const suspensions = await tx.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId));
  const suspensionMetrics = analyzeSuspensions(suspensions,
    project.noSchedule ? null : project.startDate, project.expectedEndDate, asOf);
  const analysis = {
    projectId, noSchedule: project.noSchedule, asOfDate: asOf.toISOString().slice(0, 10),
    curve,
    ...result, ...analyzeTime(project, result.plannedProgress, result.actualProgress, asOf, result.dataStatus === "stale"),
    ...suspensionMetrics, currentEndDate: project.expectedEndDate,
    contractEndDate: project.expectedEndDate, roundingTolerance: 0.01,
    status: deviationStatus(result.progressDeviation), recommendations: [],
  };
  const [record] = await tx.select().from(projectsTable).where(eq(projectsTable.id,projectId));
  const [reports] = await tx.select({value:count()}).from(reportsTable).where(eq(reportsTable.projectId,projectId));
  const [files] = await tx.select({value:count()}).from(projectFilesTable).where(eq(projectFilesTable.projectId,projectId));
  // Scope the aggregate itself (not just the returned snapshot) to the target project.
  const [extensions] = await tx.select({value:sum(projectExtensionsTable.daysAdded)})
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId));
  const targetRows = graph.activities.filter(a=>a.projectId===projectId);
  const activities = result.activitiesAnalysis.map(row=>{
    const source = targetRows.find(a=>a.id===row.activityId)!;
    return {
      id: row.activityId, name: row.activityName, groupId: row.groupId,
      actualProgress: row.actualProgress, plannedProgress: row.plannedProgress,
      plannedValueMissing: row.plannedProgress == null,
      status: row.actualProgress>=100 ? "completed" : row.actualProgress>0 ? "in_progress" : "not_started",
      plannedStartDate:source.plannedStartDate,plannedEndDate:source.plannedEndDate,actualEndDate:source.actualEndDate,
      delayed:row.delayed, delayDays:row.delayDays, weight:row.weight,
      variance:row.deviation, sourceStatus:row.sourceStatus,
      linkedToSource:row.sourceKind==="linked",
      generatedByGroup: "managedByGroupId" in source && source.managedByGroupId != null,
    };
  });
  // Deliberate allowlist: never include owner capabilities, passwords or link codes.
  return { analysis, activities, groups:graph.groups.filter(g=>g.projectId===projectId),
    project: {id:record.id,name:record.name,location:record.location,status:record.status,
      ownerEntity:record.ownerEntity,contractor:record.contractor,supervisorEntity:record.supervisorEntity,
      startDate:record.startDate,expectedEndDate:record.expectedEndDate,actualEndDate:record.actualEndDate,
      noSchedule:record.noSchedule},
    reportsCount:reports.value,filesCount:files.value,extensionDays:Number(extensions.value??0) };
 }, {isolationLevel:"repeatable read",accessMode:"read only"});
}

export async function getDeviationAnalysis(projectId: number, userId: number, curve: PlannedCurve) {
  return (await getProjectAnalysisSnapshot(projectId,userId,curve))?.analysis ?? null;
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
