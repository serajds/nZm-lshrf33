import { pgTable, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";

export const projectProgressHistoryTable = pgTable("project_progress_history", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  snapshot: jsonb("snapshot").notNull(),
}, t => [index("project_progress_history_asof_idx").on(t.projectId, t.capturedAt, t.id)]);
