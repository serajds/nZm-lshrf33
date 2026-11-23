BEGIN;

ALTER TABLE report_image_shares
  ADD COLUMN IF NOT EXISTS uploaded_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_images integer NOT NULL DEFAULT 20;

COMMIT;
