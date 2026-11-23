import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const systemImageCompressionJobsTable = pgTable("system_image_compression_jobs", {
  id: serial("id").primaryKey(),
  status: text("status", {
    enum: ["running", "pausing", "paused", "completed", "completed_with_errors"],
  }).notNull().default("running"),
  createdByUserId: integer("created_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  compressed: integer("compressed").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  currentFilename: text("current_filename"),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("system_image_compression_jobs_created_idx").on(table.createdAt),
  index("system_image_compression_jobs_lease_idx").on(table.status, table.leaseUntil),
  uniqueIndex("system_image_compression_jobs_one_running_idx")
    .on(table.status)
    .where(sql`${table.status} = 'running'`),
]);

export const systemImageCompressionItemsTable = pgTable("system_image_compression_items", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull()
    .references(() => systemImageCompressionJobsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  assetKinds: text("asset_kinds").array().notNull().default([]),
  sourceBytes: integer("source_bytes").notNull().default(0),
  sourceMimeType: text("source_mime_type"),
  status: text("status", {
    enum: ["pending", "processing", "compressed", "skipped", "failed"],
  }).notNull().default("pending"),
  outputBytes: integer("output_bytes"),
  outputMimeType: text("output_mime_type"),
  errorCode: text("error_code"),
  attempts: integer("attempts").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("system_image_compression_items_job_filename_unique").on(table.jobId, table.filename),
  index("system_image_compression_items_job_status_idx").on(table.jobId, table.status, table.id),
  index("system_image_compression_items_lease_idx").on(table.status, table.leaseUntil),
]);

export type SystemImageAssetKind =
  | "project_file"
  | "report_photo"
  | "attendance_selfie"
  | "company_logo"
  | "unreferenced_upload";
export type SystemImageCompressionItem = typeof systemImageCompressionItemsTable.$inferSelect;
export type SystemImageCompressionJob = typeof systemImageCompressionJobsTable.$inferSelect;
