import { db, activitiesTable, projectsTable, projectExtensionsTable } from "@workspace/db";
import { eq, max, sum } from "drizzle-orm";
import { captureProjectProgressHistory, type HistoryTransaction } from "./capture-project-progress-history";

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

async function recalcWithinTransaction(projectId: number, tx: HistoryTransaction): Promise<void> {
  const [project] = await tx.select({ noSchedule: projectsTable.noSchedule }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project?.noSchedule) {
    const [maxResult] = await tx
      .select({ maxEnd: max(activitiesTable.plannedEndDate) })
      .from(activitiesTable)
      .where(eq(activitiesTable.projectId, projectId));

    const baseEnd = maxResult?.maxEnd ?? null;

    // Keep an explicitly contracted expected end date when there are no dated
    // activities to derive a replacement from.
    if (baseEnd) {
      const [extResult] = await tx
        .select({ totalDays: sum(projectExtensionsTable.daysAdded) })
        .from(projectExtensionsTable)
        .where(eq(projectExtensionsTable.projectId, projectId));

      const extensionDays = extResult?.totalDays ? Number(extResult.totalDays) : 0;
      const newExpectedEnd = extensionDays > 0 ? addDaysToDateStr(baseEnd, extensionDays) : baseEnd;

      await tx.update(projectsTable)
        .set({ expectedEndDate: newExpectedEnd })
        .where(eq(projectsTable.id, projectId));
    }
  }
  await captureProjectProgressHistory(projectId, tx);
}

export async function recalcExpectedEndDate(projectId: number, transaction?: HistoryTransaction): Promise<void> {
  if (transaction) return recalcWithinTransaction(projectId, transaction);
  await db.transaction(tx => recalcWithinTransaction(projectId, tx));
}
