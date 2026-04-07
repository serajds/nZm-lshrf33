import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { projectMembersTable } from "./project_members";
import { activityGroupsTable } from "./activity_groups";

export const memberGroupAssignmentsTable = pgTable("member_group_assignments", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => projectMembersTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => activityGroupsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("member_group_unique").on(table.memberId, table.groupId),
]);

export type MemberGroupAssignment = typeof memberGroupAssignmentsTable.$inferSelect;
