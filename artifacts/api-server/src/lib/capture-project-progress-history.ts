import {
  activitiesTable,
  activityGroupsTable,
  db,
  projectProgressHistoryTable,
  projectsTable,
} from "@workspace/db";
import { asc, desc, eq, sql } from "drizzle-orm";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Capture the same report-history shape as migration 0008, from the
 * application layer. Production schema publishing does not install the
 * custom PostgreSQL triggers, so API writes must also maintain this history.
 */
export async function captureProjectProgressHistory(projectId: number): Promise<void> {
  await db.transaction(async tx => {
    // Match the lock used by migration 0008 and serialize duplicate captures.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(84620, 1)`);

    const [project] = await tx.select({
      id: projectsTable.id,
      noSchedule: projectsTable.noSchedule,
      startDate: projectsTable.startDate,
      expectedEndDate: projectsTable.expectedEndDate,
    }).from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) return;

    const activities = await tx.select({
      id: activitiesTable.id,
      name: activitiesTable.name,
      groupId: activitiesTable.groupId,
      plannedStartDate: activitiesTable.plannedStartDate,
      plannedEndDate: activitiesTable.plannedEndDate,
      actualStartDate: activitiesTable.actualStartDate,
      actualEndDate: activitiesTable.actualEndDate,
      actualProgress: activitiesTable.actualProgress,
      plannedProgress: activitiesTable.plannedProgress,
      externalSourceGroupId: activitiesTable.externalSourceGroupId,
      weight: activitiesTable.weight,
      status: activitiesTable.status,
      sortOrder: activitiesTable.sortOrder,
    }).from(activitiesTable)
      .where(eq(activitiesTable.projectId, projectId))
      .orderBy(asc(activitiesTable.sortOrder), asc(activitiesTable.id));

    const groups = await tx.select({
      id: activityGroupsTable.id,
      name: activityGroupsTable.name,
    }).from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, projectId))
      .orderBy(asc(activityGroupsTable.id));

    const snapshot = { ...project, activities, groups };
    const [latest] = await tx.select({
      snapshot: projectProgressHistoryTable.snapshot,
    }).from(projectProgressHistoryTable)
      .where(eq(projectProgressHistoryTable.projectId, projectId))
      .orderBy(desc(projectProgressHistoryTable.capturedAt), desc(projectProgressHistoryTable.id))
      .limit(1);

    // The development database may still have migration 0008 triggers.
    // Avoid storing a duplicate when those triggers already captured this state.
    if (latest && stableJson(latest.snapshot) === stableJson(snapshot)) return;

    await tx.insert(projectProgressHistoryTable).values({
      projectId,
      capturedAt: sql`clock_timestamp()`,
      snapshot,
    });
  });
}
