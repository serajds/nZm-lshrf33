-- Migration: Comments on periodic reports.
-- Apply once on production via:  psql "$DATABASE_URL" -f lib/db/migrations/0002_report_comments.sql
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "report_comments" (
  "id" serial PRIMARY KEY NOT NULL,
  "report_id" integer NOT NULL REFERENCES "reports"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "report_comments_report_idx" ON "report_comments" ("report_id");
