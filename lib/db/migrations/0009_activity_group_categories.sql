-- Apply explicitly to DEVELOPMENT; no automatic schema changes on server startup.
BEGIN;
CREATE TABLE IF NOT EXISTS activity_group_categories (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS activity_group_categories_project_idx
  ON activity_group_categories(project_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS activity_group_categories_name_unique
  ON activity_group_categories(project_id, lower(name));
ALTER TABLE activity_groups ADD COLUMN IF NOT EXISTS category_id integer
  REFERENCES activity_group_categories(id) ON DELETE SET NULL;
COMMIT;
