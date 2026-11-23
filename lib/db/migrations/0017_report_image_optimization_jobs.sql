-- Store opt-in report image backfill state so a worker can resume after a
-- process restart. This table never changes source files or report records.
BEGIN;

CREATE TABLE IF NOT EXISTS report_image_optimization_jobs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  optimized INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  next_index INTEGER NOT NULL DEFAULT 0,
  current_filename TEXT,
  last_error TEXT,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS report_image_optimization_jobs_project_created_idx
  ON report_image_optimization_jobs(project_id, created_at);
CREATE INDEX IF NOT EXISTS report_image_optimization_jobs_lease_idx
  ON report_image_optimization_jobs(status, lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS report_image_optimization_jobs_one_running_idx
  ON report_image_optimization_jobs(status)
  WHERE status = 'running';

COMMIT;
