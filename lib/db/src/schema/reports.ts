import { pgTable, text, serial, timestamp, real, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
