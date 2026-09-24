import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, real, integer, date, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  plannedStartDate: date("planned_start_date"),
  plannedEndDate: date("planned_end_date"),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  plannedProgress: real("planned_progress").notNull().default(0),
  actualProgress: real("actual_progress").notNull().default(0),
  weight: real("weight").notNull().default(1),
  status: text("status", { enum: ["not_started", "in_progress", "completed", "delayed"] }).notNull().default("not_started"),
  groupId: integer("group_id"),
  externalSourceGroupId: integer("external_source_group_id"),
  managedByGroupId: integer("managed_by_group_id"),
  managedSourceProjectId: integer("managed_source_project_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  progressUpdatedAt: timestamp("progress_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("activities_project_sort_idx").on(t.projectId, t.sortOrder),
  index("activities_group_idx").on(t.groupId),
  index("activities_external_source_group_idx").on(t.externalSourceGroupId),
  uniqueIndex("activities_managed_source_unique")
    .on(t.managedByGroupId, t.externalSourceGroupId)
    .where(sql`${t.managedByGroupId} IS NOT NULL AND ${t.externalSourceGroupId} IS NOT NULL`),
]);

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
