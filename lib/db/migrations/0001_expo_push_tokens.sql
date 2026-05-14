-- Migration: Expo push notification tokens for the mobile app.
-- Apply once on production via:  psql "$DATABASE_URL" -f lib/db/migrations/0001_expo_push_tokens.sql
-- (or via your usual migration runner). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "expo_push_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "platform" text,
  "device_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "expo_push_tokens_token_idx" ON "expo_push_tokens" ("token");
CREATE INDEX IF NOT EXISTS "expo_push_tokens_user_idx" ON "expo_push_tokens" ("user_id");
