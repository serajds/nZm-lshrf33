-- Convert legacy forecast drafts into ordinary incomplete report drafts.
-- Approved reports and project/activity progress are intentionally untouched.
BEGIN;

ALTER TABLE reports
  ALTER COLUMN progress_percentage DROP NOT NULL,
  ALTER COLUMN progress_percentage DROP DEFAULT;

UPDATE reports
SET progress_percentage = CASE
      WHEN progress_source = 'manual'
        AND report_date <= (now() AT TIME ZONE 'Africa/Tripoli')::date
        AND period_end <= (now() AT TIME ZONE 'Africa/Tripoli')::date
      THEN progress_percentage
      ELSE NULL
    END,
    activities_snapshot = NULL,
    progress_source = CASE
      WHEN progress_source = 'manual'
        AND progress_percentage IS NOT NULL
        AND report_date <= (now() AT TIME ZONE 'Africa/Tripoli')::date
        AND period_end <= (now() AT TIME ZONE 'Africa/Tripoli')::date
      THEN 'manual'
      ELSE NULL
    END,
    progress_as_of_date = CASE
      WHEN progress_source = 'manual'
        AND progress_percentage IS NOT NULL
        AND report_date <= (now() AT TIME ZONE 'Africa/Tripoli')::date
        AND period_end <= (now() AT TIME ZONE 'Africa/Tripoli')::date
      THEN period_end
      ELSE NULL
    END,
    progress_history_captured_at = NULL,
    progress_start_percentage = NULL,
    progress_history_source = NULL
WHERE forecast_draft = true
  AND status = 'draft';

ALTER TABLE reports
  DROP COLUMN forecast_draft;

COMMIT;
