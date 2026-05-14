import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const expoPushTokensTable = pgTable("expo_push_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  platform: text("platform"),
  deviceName: text("device_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("expo_push_tokens_token_idx").on(table.token),
  index("expo_push_tokens_user_idx").on(table.userId),
]);

export type ExpoPushTokenRow = typeof expoPushTokensTable.$inferSelect;
