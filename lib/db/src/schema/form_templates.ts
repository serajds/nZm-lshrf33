import { pgTable, text, serial, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { projectsTable } from "./projects";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const formTemplatesTable = pgTable("form_templates", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  fields: jsonb("fields").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFormTemplateSchema = createInsertSchema(formTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFormTemplate = z.infer<typeof insertFormTemplateSchema>;
export type FormTemplate = typeof formTemplatesTable.$inferSelect;
