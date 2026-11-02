BEGIN;
CREATE TABLE IF NOT EXISTS project_categories (
  id serial PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_categories_name_unique ON project_categories (lower(btrim(name)));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_project_id integer REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category_id integer REFERENCES project_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(parent_project_id);
CREATE INDEX IF NOT EXISTS projects_category_idx ON projects(category_id);
-- Database-wide serialization also protects direct imports and concurrent API instances.
CREATE OR REPLACE FUNCTION guard_project_portfolio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(731924614);
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM projects WHERE parent_project_id = OLD.id) THEN
      RAISE EXCEPTION 'فك ارتباط المشاريع التابعة قبل حذف المشروع الرئيسي' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.parent_project_id IS NOT NULL THEN
    IF NEW.parent_project_id = NEW.id
      OR EXISTS (SELECT 1 FROM projects WHERE id = NEW.parent_project_id AND parent_project_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM projects WHERE parent_project_id = NEW.id) THEN
      RAISE EXCEPTION 'يسمح بمستويين فقط: مشروع رئيسي ثم فرعي، دون دورات أو إسناد للنفس' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_portfolio_guard ON projects;
CREATE TRIGGER project_portfolio_guard BEFORE INSERT OR UPDATE OF parent_project_id OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION guard_project_portfolio();
COMMIT;
