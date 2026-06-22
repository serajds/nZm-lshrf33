import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

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
}, (t) => [
  index("audit_log_created_idx").on(t.createdAt),
  index("audit_log_project_created_idx").on(t.projectId, t.createdAt),
  index("audit_log_entity_idx").on(t.entityType, t.action),
]);
