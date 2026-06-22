import { pgTable, text, serial, timestamp, date, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const projectExtensionsTable = pgTable("project_extensions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  extensionDate: date("extension_date").notNull(),
  daysAdded: integer("days_added").notNull(),
  newEndDate: date("new_end_date").notNull(),
  reason: text("reason"),
  documentRef: text("document_ref"),
  approvedBy: text("approved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("project_extensions_project_idx").on(t.projectId, t.extensionDate),
]);

export const insertProjectExtensionSchema = createInsertSchema(projectExtensionsTable).omit({ id: true, createdAt: true });
export type InsertProjectExtension = z.infer<typeof insertProjectExtensionSchema>;
export type ProjectExtension = typeof projectExtensionsTable.$inferSelect;
