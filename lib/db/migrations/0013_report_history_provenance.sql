-- Apply to DEVELOPMENT explicitly after reviewing the report provenance change.
BEGIN;
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS progress_history_source text;
DO $$ BEGIN
  ALTER TABLE reports
    ADD CONSTRAINT reports_progress_history_source_check
    CHECK (progress_history_source IS NULL OR progress_history_source IN ('actual', 'estimated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
COMMIT;
