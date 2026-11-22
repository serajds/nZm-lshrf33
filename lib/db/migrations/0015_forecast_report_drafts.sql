ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS forecast_draft boolean NOT NULL DEFAULT false;
