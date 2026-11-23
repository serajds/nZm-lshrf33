-- Persist administrator-triggered image compression progress independently
-- from report-print backfill jobs. Originals are changed only by the worker
-- after the new image bytes have been decoded and verified.
BEGIN;

CREATE TABLE IF NOT EXISTS system_image_compression_jobs (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  compressed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  current_filename TEXT,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS system_image_compression_items (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES system_image_compression_jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  asset_kinds TEXT[] NOT NULL DEFAULT '{}',
  source_bytes INTEGER NOT NULL DEFAULT 0,
  source_mime_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  output_bytes INTEGER,
  output_mime_type TEXT,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_image_compression_jobs_created_idx
  ON system_image_compression_jobs(created_at);
CREATE INDEX IF NOT EXISTS system_image_compression_jobs_lease_idx
  ON system_image_compression_jobs(status, lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS system_image_compression_jobs_one_running_idx
  ON system_image_compression_jobs(status)
  WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS system_image_compression_items_job_filename_unique
  ON system_image_compression_items(job_id, filename);
CREATE INDEX IF NOT EXISTS system_image_compression_items_job_status_idx
  ON system_image_compression_items(job_id, status, id);
CREATE INDEX IF NOT EXISTS system_image_compression_items_lease_idx
  ON system_image_compression_items(status, lease_until);

COMMIT;
