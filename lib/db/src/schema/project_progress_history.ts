import { pgTable, serial, integer, timestamp, jsonb, index, text, foreignKey, uniqueIndex } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectProgressHistoryBatchesTable = pgTable("project_progress_history_batches", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  methodology: text("methodology").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  createdById: integer("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revertedAt: timestamp("reverted_at", { withTimezone: true }),
}, t => [
  index("project_progress_history_batches_project_idx").on(t.projectId, t.createdAt),
  uniqueIndex("project_progress_history_batches_project_fingerprint_unique").on(t.projectId, t.fingerprint),
]);

export const projectProgressHistoryTable = pgTable("project_progress_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb("snapshot").notNull(),
  source: text("source", { enum: ["actual", "estimated"] }).notNull().default("actual"),
  importBatchId: integer("import_batch_id"),
  createdById: integer("created_by_id"),
  methodology: text("methodology"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("project_progress_history_asof_idx").on(t.projectId, t.capturedAt, t.id),
  index("project_progress_history_batch_idx").on(t.importBatchId),
  foreignKey({
    name: "project_progress_history_batch_fk",
    columns: [t.importBatchId],
    foreignColumns: [projectProgressHistoryBatchesTable.id],
  }).onDelete("cascade"),
]);
