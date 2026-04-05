import { pgTable, text, serial, timestamp, real, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  plannedStartDate: date("planned_start_date").notNull(),
  plannedEndDate: date("planned_end_date").notNull(),
  actualStartDate: date("actual_start_date"),
  actualEndDate: date("actual_end_date"),
  plannedProgress: real("planned_progress").notNull().default(0),
  actualProgress: real("actual_progress").notNull().default(0),
  status: text("status", { enum: ["not_started", "in_progress", "completed", "delayed"] }).notNull().default("not_started"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
