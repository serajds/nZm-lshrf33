import { pgTable, serial, integer, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";

export const activityGroupCategoriesTable = pgTable("activity_group_categories", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, table => [
  index("activity_group_categories_project_idx").on(table.projectId, table.sortOrder),
  uniqueIndex("activity_group_categories_name_unique").on(table.projectId, sql`lower(${table.name})`),
]);
