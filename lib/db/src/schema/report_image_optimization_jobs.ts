import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export type ReportImageOptimizationItem = {
  filename: string;
  fileSize: number;
};

export const reportImageOptimizationJobsTable = pgTable("report_image_optimization_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["running", "paused", "completed", "completed_with_errors"],
  }).notNull().default("running"),
  items: jsonb("items").$type<ReportImageOptimizationItem[]>().notNull().default([]),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  optimized: integer("optimized").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  nextIndex: integer("next_index").notNull().default(0),
  currentFilename: text("current_filename"),
  lastError: text("last_error"),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("report_image_optimization_jobs_project_created_idx").on(t.projectId, t.createdAt),
  index("report_image_optimization_jobs_lease_idx").on(t.status, t.leaseUntil),
  uniqueIndex("report_image_optimization_jobs_one_running_idx")
    .on(t.status)
    .where(sql`${t.status} = 'running'`),
]);
