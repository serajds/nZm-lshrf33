BEGIN;

ALTER TABLE image_assets
  DROP CONSTRAINT IF EXISTS image_assets_ready_complete;

ALTER TABLE image_assets
  ADD CONSTRAINT image_assets_ready_complete CHECK (
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
  );

COMMIT;
