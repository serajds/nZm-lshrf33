import { pgTable, text, serial, timestamp, real, date, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
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
  summaryWidgets: jsonb("summary_widgets").default([]),
  onedriveTestResultsFolderId: text("onedrive_test_results_folder_id"),
  siteLatitude: real("site_latitude"),
  siteLongitude: real("site_longitude"),
  siteRadiusMeters: integer("site_radius_meters").default(200),
  attendanceAutoCloseHours: integer("attendance_auto_close_hours").notNull().default(12),
  attendanceLongDayHours: integer("attendance_long_day_hours").notNull().default(10),
  reportSignatures: jsonb("report_signatures").$type<{id: string; title: string; role: string; name?: string}[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("projects_contractor_company_idx").on(t.contractorCompanyId),
  index("projects_owner_company_idx").on(t.ownerCompanyId),
  index("projects_supervisor_company_idx").on(t.supervisorCompanyId),
  index("projects_owner_token_idx").on(t.ownerAccessToken),
  index("projects_status_idx").on(t.status),
]);

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
