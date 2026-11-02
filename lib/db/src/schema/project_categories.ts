import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const projectCategoriesTable = pgTable("project_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
}, t => [uniqueIndex("project_categories_name_unique").on(sql`lower(btrim(${t.name}))`)]);
