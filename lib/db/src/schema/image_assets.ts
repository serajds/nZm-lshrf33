import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projectsTable } from "./projects";
import { usersTable } from "./users";
import { projectFilesTable } from "./project_files";

// References and lifecycle metadata only. Never source/base64 image content.
export const imageAssetsTable = pgTable("image_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  scope: text("scope").notNull(),
  clientKey: text("client_key").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  profile: text("profile").notNull(),
  policyVersion: integer("policy_version").notNull(),
  state: text("state").notNull(),
  primaryState: text("primary_state").notNull(),
  thumbnailState: text("thumbnail_state").notNull(),
  printState: text("print_state").notNull(),
  storageKey: text("storage_key"),
  storageBucket: text("storage_bucket"),
  thumbnailKey: text("thumbnail_key"),
  printKey: text("print_key"),
  projectFileId: integer("project_file_id").references(() => projectFilesTable.id, { onDelete: "set null" }),
  cleanupPending: boolean("cleanup_pending").notNull().default(false),
  exceptions: jsonb("exceptions").notNull().default([]).$type<Array<{ variant: string; code: string }>>(),
  attemptHistory: jsonb("attempt_history").notNull().default([]).$type<Array<{
    attemptToken: string; storageBucket: string | null; storageKey: string | null; thumbnailKey: string | null; printKey: string | null;
  }>>(),
  mimeType: text("mime_type"),
  byteSize: integer("byte_size"),
  width: integer("width"),
  height: integer("height"),
  attemptToken: uuid("attempt_token").notNull(),
  attemptCount: integer("attempt_count").notNull().default(1),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  errorCode: text("error_code"),
  retryable: boolean("retryable").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("image_assets_scope_client_key_uidx").on(table.scope, table.clientKey),
  uniqueIndex("image_assets_storage_key_uidx").on(table.storageKey),
  index("image_assets_project_idx").on(table.projectId),
  index("image_assets_recovery_idx").on(table.state, table.leaseExpiresAt),
  check("image_assets_ready_complete", sql`${table.state} <> 'ready' OR (
    ${table.storageKey} IS NOT NULL AND ${table.storageBucket} IS NOT NULL AND ${table.mimeType} IS NOT NULL
    AND ${table.byteSize} IS NOT NULL AND ${table.width} IS NOT NULL AND ${table.height} IS NOT NULL
    AND ${table.byteSize} > 0 AND ${table.width} > 0 AND ${table.height} > 0
    AND ${table.primaryState} = 'ready'
    AND (${table.profile} NOT IN ('report', 'report_detail', 'report_technical') OR (
      ${table.thumbnailKey} IS NOT NULL AND ${table.thumbnailState} = 'ready'
      AND ${table.printKey} IS NOT NULL AND ${table.printState} = 'ready'
    ))
  )`),
]);
