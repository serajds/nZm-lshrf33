export function normalizeCategoryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/gu, " ");
  return name.length > 0 && name.length <= 120 ? name : null;
}
export type CategoryAssignment = { groupIds: number[]; categoryId: number | null; newCategoryName?: string };
export function parseCategoryAssignment(body: unknown): CategoryAssignment | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const ids = value.groupIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id > 2147483647) || new Set(ids).size !== ids.length) return null;
  if (value.categoryId !== null && (!Number.isSafeInteger(value.categoryId) || Number(value.categoryId) <= 0 || Number(value.categoryId) > 2147483647)) return null;
  if (value.newCategoryName !== undefined) {
    const name = normalizeCategoryName(value.newCategoryName);
    if (!name || value.categoryId !== null) return null;
    return { groupIds: ids, categoryId: null, newCategoryName: name };
  }
  return { groupIds: ids, categoryId: value.categoryId as number | null };
}
