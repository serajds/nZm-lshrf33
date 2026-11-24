-- Additive image lifecycle and report-share upload tracking schema.
-- These tables contain metadata and references only; image bytes stay in object storage.
BEGIN;

CREATE TABLE IF NOT EXISTS image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scope TEXT NOT NULL,
  client_key TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  profile TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  primary_state TEXT NOT NULL,
  thumbnail_state TEXT NOT NULL,
  print_state TEXT NOT NULL,
  storage_key TEXT,
  storage_bucket TEXT,
  thumbnail_key TEXT,
  print_key TEXT,
  project_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL,
  cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  attempt_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  mime_type TEXT,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  attempt_token UUID NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  error_code TEXT,
  retryable BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT image_assets_ready_complete CHECK (
    state <> 'ready' OR (
      storage_key IS NOT NULL
      AND storage_bucket IS NOT NULL
      AND mime_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND width IS NOT NULL
      AND height IS NOT NULL
      AND byte_size > 0
      AND width > 0
      AND height > 0
      AND primary_state = 'ready'
      AND (
        profile NOT IN ('report', 'report_detail', 'report_technical')
        OR (
          thumbnail_key IS NOT NULL
          AND thumbnail_state = 'ready'
          AND print_key IS NOT NULL
          AND print_state = 'ready'
        )
      )
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS image_assets_scope_client_key_uidx
  ON image_assets (scope, client_key);
CREATE UNIQUE INDEX IF NOT EXISTS image_assets_storage_key_uidx
  ON image_assets (storage_key);
CREATE INDEX IF NOT EXISTS image_assets_project_idx
  ON image_assets (project_id);
CREATE INDEX IF NOT EXISTS image_assets_recovery_idx
  ON image_assets (state, lease_expires_at);

CREATE TABLE IF NOT EXISTS report_image_share_uploads (
  id SERIAL PRIMARY KEY,
  share_id INTEGER NOT NULL REFERENCES report_image_shares(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading',
  position INTEGER NOT NULL,
  group_start_index INTEGER NOT NULL,
  project_file_id INTEGER REFERENCES project_files(id) ON DELETE SET NULL,
  file_url TEXT,
  error_code TEXT,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_image_share_uploads_share_client_key
    UNIQUE (share_id, client_key)
);

CREATE INDEX IF NOT EXISTS report_image_share_uploads_recovery_idx
  ON report_image_share_uploads (state, lease_expires_at);

COMMIT;
