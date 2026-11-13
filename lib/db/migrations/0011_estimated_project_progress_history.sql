-- Apply to DEVELOPMENT explicitly after reviewing the resulting schema.
-- This migration records estimated historical snapshots separately from live captures.
BEGIN;

CREATE TABLE IF NOT EXISTS project_progress_history_batches (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  methodology text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_by_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  CONSTRAINT project_progress_history_batches_project_fingerprint_unique
    UNIQUE (project_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS project_progress_history_batches_project_idx
  ON project_progress_history_batches(project_id, created_at);

ALTER TABLE project_progress_history
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'actual',
  ADD COLUMN IF NOT EXISTS import_batch_id integer,
  ADD COLUMN IF NOT EXISTS created_by_id integer,
  ADD COLUMN IF NOT EXISTS methodology text,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE project_progress_history
    ADD CONSTRAINT project_progress_history_source_check CHECK (source IN ('actual', 'estimated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE project_progress_history
    ADD CONSTRAINT project_progress_history_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES project_progress_history_batches(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS project_progress_history_batch_idx
  ON project_progress_history(import_batch_id);
COMMIT;
