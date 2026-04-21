import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectMembersTable = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["project_manager", "engineer", "contractor", "viewer"] }).notNull().default("engineer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("project_members_project_user_unique").on(table.projectId, table.userId),
]);

export const insertProjectMemberSchema = createInsertSchema(projectMembersTable).omit({ id: true, createdAt: true });
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type ProjectMember = typeof projectMembersTable.$inferSelect;
