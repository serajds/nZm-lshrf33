import { pgTable, serial, integer, text, timestamp, real, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const attendanceRecordsTable = pgTable("attendance_records", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["check_in", "check_out"] }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  accuracyMeters: real("accuracy_meters"),
  distanceMeters: real("distance_meters"),
  outOfRange: boolean("out_of_range").notNull().default(false),
  selfieFilename: text("selfie_filename"),
  selfieUrl: text("selfie_url"),
  notes: text("notes"),
  // Client-generated UUID for offline-safe idempotency: a re-sent request
  // (after a flaky network or queued offline) MUST NOT create a duplicate
  // record. The unique index below is enforced per-user.
  clientId: text("client_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editedByUserId: integer("edited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  editReason: text("edit_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("attendance_project_user_idx").on(table.projectId, table.userId, table.recordedAt),
  index("attendance_project_recorded_idx").on(table.projectId, table.recordedAt),
  uniqueIndex("attendance_user_client_id_idx").on(table.userId, table.clientId),
]);

export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecordsTable).omit({ id: true, createdAt: true });
export type InsertAttendanceRecord = z.infer<typeof insertAttendanceRecordSchema>;
export type AttendanceRecord = typeof attendanceRecordsTable.$inferSelect;
