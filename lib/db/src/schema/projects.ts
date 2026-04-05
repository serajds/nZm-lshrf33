import { pgTable, text, serial, timestamp, real, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  ownerEntity: text("owner_entity").notNull(),
  supervisorEntity: text("supervisor_entity").notNull(),
  contractor: text("contractor").notNull(),
  startDate: date("start_date").notNull(),
  expectedEndDate: date("expected_end_date").notNull(),
  actualEndDate: date("actual_end_date"),
  status: text("status", { enum: ["active", "completed", "delayed", "suspended"] }).notNull().default("active"),
  overallProgress: real("overall_progress").notNull().default(0),
  ownerAccessToken: text("owner_access_token"),
  ownerAccessPassword: text("owner_access_password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
