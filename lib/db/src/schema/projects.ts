import { pgTable, text, serial, timestamp, real, date, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  ownerEntity: text("owner_entity").notNull(),
  supervisorEntity: text("supervisor_entity").notNull(),
  contractor: text("contractor").notNull(),
  noSchedule: boolean("no_schedule").notNull().default(false),
  startDate: date("start_date"),
  expectedEndDate: date("expected_end_date"),
  actualEndDate: date("actual_end_date"),
  status: text("status", { enum: ["active", "completed", "delayed", "suspended"] }).notNull().default("active"),
  overallProgress: real("overall_progress").notNull().default(0),
  ownerAccessToken: text("owner_access_token"),
  ownerAccessPassword: text("owner_access_password"),
  ownerCompanyId: integer("owner_company_id"),
  contractorCompanyId: integer("contractor_company_id"),
  supervisorCompanyId: integer("supervisor_company_id"),
  onedriveTestResultsFolderId: text("onedrive_test_results_folder_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
