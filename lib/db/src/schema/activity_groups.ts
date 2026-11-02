import { pgTable, text, serial, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { activityGroupCategoriesTable } from "./activity_group_categories";

export const activityGroupsTable = pgTable("activity_groups", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  sortOrder: integer("sort_order").notNull().default(0),
  categoryId: integer("category_id").references(() => activityGroupCategoriesTable.id, { onDelete: "set null" }),
  linkCode: text("link_code"),
  linkedProjectId: integer("linked_project_id"),
}, (t) => [
  index("activity_groups_project_idx").on(t.projectId, t.sortOrder),
  uniqueIndex("activity_groups_link_code_unique").on(t.linkCode),
]);

export type ActivityGroup = typeof activityGroupsTable.$inferSelect;
