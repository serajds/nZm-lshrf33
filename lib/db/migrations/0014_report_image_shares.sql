BEGIN;

CREATE TABLE IF NOT EXISTS report_image_shares (
  id serial PRIMARY KEY,
  project_id integer NOT NULL,
  report_id integer NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  group_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'completed', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_by_id integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_image_shares_report_group_idx
  ON report_image_shares (report_id, group_id, created_at);
CREATE INDEX IF NOT EXISTS report_image_shares_expiry_idx
  ON report_image_shares (expires_at);

COMMIT;
