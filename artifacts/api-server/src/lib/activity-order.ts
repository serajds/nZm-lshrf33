import { sql, type SQLWrapper } from "drizzle-orm";

export type ActivityOrderItem = { id: number; sortOrder: number; groupId?: number | null };
export function validActivityOrderItems(value: unknown): value is ActivityOrderItem[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10000
    && value.every(item => item && Number.isSafeInteger(item.id) && item.id > 0 && item.id <= 2147483647
      && Number.isSafeInteger(item.sortOrder) && item.sortOrder >= 0 && item.sortOrder <= 2147483647
      && (item.groupId === undefined || item.groupId === null || (Number.isSafeInteger(item.groupId) && item.groupId > 0)))
    && new Set(value.map(item => item.id)).size === value.length;
}
export function activityOrderCase(idColumn: SQLWrapper, items: ActivityOrderItem[]) {
  return sql`CASE ${sql.join(items.map(item => sql`WHEN ${idColumn} = ${item.id} THEN ${item.sortOrder}::integer`), sql` `)} END`;
}
