import { pgTable, text, serial, timestamp, real, integer, date, jsonb, index, boolean, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectFilesTable } from "./project_files";

export type ReportImageGroup = { id?: string; category: string; urls: string[] };

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  reportNumber: integer("report_number").notNull().default(0),
  type: text("type", { enum: ["weekly", "monthly", "period"] }).notNull(),
  reportDate: date("report_date").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  workDescription: text("work_description").notNull(),
  progressPercentage: real("progress_percentage"),
  technicalNotes: text("technical_notes"),
  recommendations: text("recommendations"),
  imageUrls: text("image_urls").array().notNull().default([]),
  imageGroups: jsonb("image_groups").$type<ReportImageGroup[]>(),
  activitiesSnapshot: jsonb("activities_snapshot"),
  progressSource: text("progress_source", { enum: ["history", "manual"] }),
  progressAsOfDate: date("progress_as_of_date"),
  progressHistoryCapturedAt: timestamp("progress_history_captured_at", { withTimezone: true }),
  progressStartPercentage: real("progress_start_percentage"),
  progressHistorySource: text("progress_history_source", { enum: ["actual", "estimated"] }),
  status: text("status", { enum: ["draft", "approved"] }).notNull().default("draft"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedById: integer("approved_by_id"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("reports_project_date_idx").on(t.projectId, t.reportDate),
]);

export const reportImageSharesTable = pgTable("report_image_shares", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  reportId: integer("report_id").notNull().references(() => reportsTable.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  status: text("status", { enum: ["pending", "uploading", "completed", "cancelled"] }).notNull().default("pending"),
  uploadedCount: integer("uploaded_count").notNull().default(0),
  maxImages: integer("max_images").notNull().default(20),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("report_image_shares_report_group_idx").on(t.reportId, t.groupId, t.createdAt),
  index("report_image_shares_expiry_idx").on(t.expiresAt),
  unique("report_image_shares_token_hash_key").on(t.tokenHash),
]);

export const reportImageShareUploadsTable = pgTable("report_image_share_uploads", {
  id: serial("id").primaryKey(),
  shareId: integer("share_id").notNull().references(() => reportImageSharesTable.id, { onDelete: "cascade" }),
  clientKey: text("client_key").notNull(),
  state: text("state", { enum: ["uploading", "ready", "failed"] }).notNull().default("uploading"),
  position: integer("position").notNull(),
  groupStartIndex: integer("group_start_index").notNull(),
  projectFileId: integer("project_file_id").references(() => projectFilesTable.id, { onDelete: "set null" }),
  fileUrl: text("file_url"),
  errorCode: text("error_code"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, table => [
  unique("report_image_share_uploads_share_client_key").on(table.shareId, table.clientKey),
  index("report_image_share_uploads_recovery_idx").on(table.state, table.leaseExpiresAt),
]);

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
