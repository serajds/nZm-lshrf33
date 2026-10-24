-- Apply to DEVELOPMENT explicitly. Never run migrations from application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS project_progress_history (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS project_progress_history_asof_idx
  ON project_progress_history(project_id, captured_at, id);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS progress_source text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS progress_as_of_date date;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS progress_history_captured_at timestamptz;

CREATE OR REPLACE FUNCTION capture_project_progress_history(pid integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE state jsonb;
BEGIN
  -- Serialize capture, including multi-project source propagation, in commit order.
  PERFORM pg_advisory_xact_lock(84620, 1);
  SELECT jsonb_build_object(
    'projectId', p.id,
    'noSchedule', p.no_schedule,
    'startDate', p.start_date,
    'expectedEndDate', p.expected_end_date,
    'activities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'groupId', a.group_id,
        'plannedStartDate', a.planned_start_date, 'plannedEndDate', a.planned_end_date,
        'actualStartDate', a.actual_start_date, 'actualEndDate', a.actual_end_date,
        'actualProgress', a.actual_progress, 'plannedProgress', a.planned_progress,
        'externalSourceGroupId', a.external_source_group_id,
        'weight', a.weight, 'status', a.status, 'sortOrder', a.sort_order
      ) ORDER BY a.sort_order, a.id)
      FROM activities a WHERE a.project_id = p.id
    ), '[]'::jsonb),
    'groups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.id)
      FROM activity_groups g WHERE g.project_id = p.id
    ), '[]'::jsonb)
  ) INTO state FROM projects p WHERE p.id = pid;
  IF state IS NULL THEN RETURN; END IF;
  IF state IS NOT DISTINCT FROM (
    SELECT snapshot FROM project_progress_history WHERE project_id = pid
    ORDER BY captured_at DESC, id DESC LIMIT 1
  ) THEN RETURN; END IF;
  INSERT INTO project_progress_history(project_id, captured_at, snapshot)
    VALUES (pid, clock_timestamp(), state);
END $$;

CREATE OR REPLACE FUNCTION capture_activity_statement_history() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pid integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR pid IN SELECT DISTINCT project_id FROM new_rows ORDER BY project_id LOOP
      PERFORM capture_project_progress_history(pid);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR pid IN SELECT DISTINCT project_id FROM old_rows ORDER BY project_id LOOP
      PERFORM capture_project_progress_history(pid);
    END LOOP;
  ELSE
    FOR pid IN SELECT project_id FROM new_rows UNION SELECT project_id FROM old_rows ORDER BY project_id LOOP
      PERFORM capture_project_progress_history(pid);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS activities_history_insert ON activities;
CREATE TRIGGER activities_history_insert AFTER INSERT ON activities
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION capture_activity_statement_history();
DROP TRIGGER IF EXISTS activities_history_update ON activities;
CREATE TRIGGER activities_history_update AFTER UPDATE ON activities
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION capture_activity_statement_history();
DROP TRIGGER IF EXISTS activities_history_delete ON activities;
CREATE TRIGGER activities_history_delete AFTER DELETE ON activities
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION capture_activity_statement_history();

CREATE OR REPLACE FUNCTION capture_project_or_group_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    PERFORM capture_project_progress_history(NEW.id);
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM capture_project_progress_history(OLD.project_id); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM capture_project_progress_history(NEW.project_id); END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS projects_progress_history ON projects;
CREATE TRIGGER projects_progress_history AFTER INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION capture_project_or_group_history();
DROP TRIGGER IF EXISTS groups_progress_history ON activity_groups;
CREATE TRIGGER groups_progress_history AFTER INSERT OR UPDATE OR DELETE ON activity_groups
  FOR EACH ROW EXECUTE FUNCTION capture_project_or_group_history();

-- This is today's baseline, not a reconstruction of earlier report periods.
SELECT capture_project_progress_history(id) FROM projects ORDER BY id;
COMMIT;
