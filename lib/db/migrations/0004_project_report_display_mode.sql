ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "report_display_mode" text NOT NULL DEFAULT 'type_and_number';