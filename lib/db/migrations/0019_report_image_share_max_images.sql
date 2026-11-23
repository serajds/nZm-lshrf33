BEGIN;

ALTER TABLE report_image_shares
  ADD COLUMN IF NOT EXISTS max_images INTEGER NOT NULL DEFAULT 20;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'report_image_shares_max_images_range_check'
  ) THEN
    ALTER TABLE report_image_shares
      ADD CONSTRAINT report_image_shares_max_images_range_check
      CHECK (max_images BETWEEN 1 AND 1000);
  END IF;
END $$;

COMMIT;
