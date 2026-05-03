import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { formTemplatesTable } from "./form_templates";
import { usersTable } from "./users";

export const skippedDaysTable = pgTable("skipped_days", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => formTemplatesTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  reason: text("reason"),
  skippedById: integer("skipped_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("skipped_days_template_date_idx").on(t.templateId, t.date),
  index("skipped_days_project_idx").on(t.projectId),
]);
