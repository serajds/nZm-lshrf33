export type CategoryFilter = "all" | "uncategorized" | number;
export type CategorizedGroup = { id: number; categoryId?: number | null };
export function groupsForCategory<T extends CategorizedGroup>(groups: readonly T[], filter: CategoryFilter): T[] {
  return groups.filter(group => filter === "all" || (filter === "uncategorized"
    ? group.categoryId == null : group.categoryId === filter));
}
export function activityMatchesCategory(groupId: number | null, filter: CategoryFilter, groupIds: ReadonlySet<number>) {
  return filter === "all" || (groupId === null ? filter === "uncategorized" : groupIds.has(groupId));
}
