import { pgTable, text, serial, integer, index } from "drizzle-orm/pg-core";

export const activityGroupsTable = pgTable("activity_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [
  index("activity_groups_project_idx").on(t.projectId, t.sortOrder),
]);

export type ActivityGroup = typeof activityGroupsTable.$inferSelect;
