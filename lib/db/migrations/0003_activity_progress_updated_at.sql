-- Migration: Track when an activity's execution state (progress/status/actual dates) last changed,
-- so AI report drafting can scope activities to the report period.
-- Apply once on production via:  psql "$DATABASE_URL" -f lib/db/migrations/0003_activity_progress_updated_at.sql
-- Idempotent — safe to re-run.

ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "progress_updated_at" timestamp with time zone;
