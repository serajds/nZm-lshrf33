import { db, activityGroupsTable, activitiesTable } from "@workspace/db";
import { and, eq, notExists } from "drizzle-orm";
import { withSourceGraphLock } from "./external-sources";

export async function deleteEmptyActivityGroup(
  projectId: number,
  groupId: number,
): Promise<"deleted" | "not_empty" | "not_found"> {
  return withSourceGraphLock(async () => {
    // Check emptiness in the DELETE statement itself, rather than checking first
    // and unassigning children as the old route did. The shared graph lock also
    // serializes this delete with activity assignment writes.
    const [deleted] = await db.delete(activityGroupsTable)
      .where(and(
        eq(activityGroupsTable.id, groupId),
        eq(activityGroupsTable.projectId, projectId),
        notExists(db.select({ id: activitiesTable.id }).from(activitiesTable)
          .where(and(eq(activitiesTable.projectId, projectId), eq(activitiesTable.groupId, groupId)))),
      ))
      .returning({ id: activityGroupsTable.id });
    if (deleted) return "deleted";

    const [group] = await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(and(eq(activityGroupsTable.id, groupId), eq(activityGroupsTable.projectId, projectId)));
    return group ? "not_empty" : "not_found";
  });
}