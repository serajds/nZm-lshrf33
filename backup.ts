import { db, activitiesTable, projectsTable, projectExtensionsTable } from "@workspace/db";
import { eq, max, sum } from "drizzle-orm";

export async function getActivitiesBaseEndDate(projectId: number): Promise<string | null> {
  const [maxResult] = await db
    .select({ maxEnd: max(activitiesTable.plannedEndDate) })
    .from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId));

  return maxResult?.maxEnd ?? null;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export async function recalcExpectedEndDate(projectId: number) {
  const [project] = await db.select({ noSchedule: projectsTable.noSchedule }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (project?.noSchedule) return;

  const baseEnd = await getActivitiesBaseEndDate(projectId);

  if (!baseEnd) return;

  const [extResult] = await db
    .select({ totalDays: sum(projectExtensionsTable.daysAdded) })
    .from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, projectId));

  const extensionDays = extResult?.totalDays ? Number(extResult.totalDays) : 0;

  const newExpectedEnd = extensionDays > 0 ? addDaysToDateStr(baseEnd, extensionDays) : baseEnd;

  await db.update(projectsTable)
    .set({ expectedEndDate: newExpectedEnd })
    .where(eq(projectsTable.id, projectId));
}
