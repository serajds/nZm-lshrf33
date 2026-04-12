import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { formTemplatesTable } from "./form_templates";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const formSubmissionsTable = pgTable("form_submissions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => formTemplatesTable.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().default({}),
  submittedById: integer("submitted_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  submittedByName: text("submitted_by_name"),
  status: text("status", { enum: ["draft", "submitted", "reviewed"] }).notNull().default("submitted"),
  reportDate: text("report_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFormSubmissionSchema = createInsertSchema(formSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFormSubmission = z.infer<typeof insertFormSubmissionSchema>;
export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
