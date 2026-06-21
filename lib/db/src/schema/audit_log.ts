import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  userName: text("user_name"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  entityName: text("entity_name"),
  projectId: integer("project_id"),
  projectName: text("project_name"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
