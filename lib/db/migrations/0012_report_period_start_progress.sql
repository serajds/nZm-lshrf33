-- Apply to DEVELOPMENT explicitly after reviewing the report-period summary change.
BEGIN;
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS progress_start_percentage real;
COMMIT;
