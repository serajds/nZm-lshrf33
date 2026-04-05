import { pgTable, text, serial, timestamp, date, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const projectSuspensionsTable = pgTable("project_suspensions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["official_holiday", "force_majeure", "contractor_delay"] }).notNull(),
  title: text("title").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  calendarDays: integer("calendar_days").notNull(),
  reason: text("reason"),
  documentRef: text("document_ref"),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectSuspensionSchema = createInsertSchema(projectSuspensionsTable).omit({ id: true, createdAt: true });
export type InsertProjectSuspension = z.infer<typeof insertProjectSuspensionSchema>;
export type ProjectSuspension = typeof projectSuspensionsTable.$inferSelect;
