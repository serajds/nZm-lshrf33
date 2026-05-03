import { pgTable, text, serial, timestamp, real, integer, date, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type ReportImageGroup = { category: string; urls: string[] };

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  reportNumber: integer("report_number").notNull().default(0),
  type: text("type", { enum: ["weekly", "monthly"] }).notNull(),
  reportDate: date("report_date").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  workDescription: text("work_description").notNull(),
  progressPercentage: real("progress_percentage").notNull().default(0),
  technicalNotes: text("technical_notes"),
  recommendations: text("recommendations"),
  imageUrls: text("image_urls").array().notNull().default([]),
  imageGroups: jsonb("image_groups").$type<ReportImageGroup[]>(),
  activitiesSnapshot: jsonb("activities_snapshot"),
  status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: integer("approved_by_id"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("reports_project_date_idx").on(t.projectId, t.reportDate),
]);

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
