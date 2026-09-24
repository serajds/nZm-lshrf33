import { pgTable, text, serial, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const activityGroupsTable = pgTable("activity_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  sortOrder: integer("sort_order").notNull().default(0),
  linkCode: text("link_code"),
}, (t) => [
  index("activity_groups_project_idx").on(t.projectId, t.sortOrder),
  uniqueIndex("activity_groups_link_code_unique").on(t.linkCode),
]);

export type ActivityGroup = typeof activityGroupsTable.$inferSelect;
