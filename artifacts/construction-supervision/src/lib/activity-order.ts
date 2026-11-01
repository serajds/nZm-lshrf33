type OrderedActivity = { id: number; sortOrder?: number | null; groupId?: number | null };
export function compareActivityOrder(a: OrderedActivity, b: OrderedActivity) {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id;
}

/** Reorder the visible subset in its original slots; never move a hidden row or change a group. */
export function planActivityReorder<T extends OrderedActivity>(
  rows: readonly T[], visibleIds: readonly number[], activeId: number, overId: number,
) {
  const ordered = [...rows].sort(compareActivityOrder);
  const active = ordered.find(row => row.id === activeId);
  const over = ordered.find(row => row.id === overId);
  if (!active || !over || (active.groupId ?? null) !== (over.groupId ?? null)) return [];
  const visible = new Set(visibleIds);
  const selected = ordered.filter(row => visible.has(row.id) && (row.groupId ?? null) === (active.groupId ?? null));
  const from = selected.findIndex(row => row.id === activeId);
  const to = selected.findIndex(row => row.id === overId);
  if (from < 0 || to < 0 || from === to) return [];
  const [moved] = selected.splice(from, 1);
  selected.splice(to, 0, moved);
  let index = 0;
  return ordered
    .map(row => visible.has(row.id) && (row.groupId ?? null) === (active.groupId ?? null) ? selected[index++] : row)
    .map((row, sortOrder) => ({ id: row.id, sortOrder }))
    .filter(item => rows.find(row => row.id === item.id)?.sortOrder !== item.sortOrder);
}

export function applyActivityOrder<T extends OrderedActivity>(rows: readonly T[], items: { id: number; sortOrder: number }[]) {
  const orders = new Map(items.map(item => [item.id, item.sortOrder]));
  return rows.map(row => orders.has(row.id) ? { ...row, sortOrder: orders.get(row.id)! } : row).sort(compareActivityOrder);
}
