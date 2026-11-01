---
name: Activity and Excel ordering
description: Stable drag ordering and source-file sequence without changing group ownership or unrelated groups.
---

Do not mix group-local renumbering with the schedule's global sort key. A drag changes order within its current group, not group membership; preserve hidden rows in their original slots when filters are active.

**Why:** Mixing local and global positions creates ties and unstable reloads. Treating a reorder as a move also risks changing ownership of linked, managed activities.

**How to apply:** Keep a deterministic tie-breaker for legacy equal positions, match sortable registrations to actual visible DOM order, and preserve all non-order fields. Group reassignment remains a separate action.

Excel's row sequence is the source of truth, not alphabetical order or activity dates. Reused groups must participate in the imported group sequence; groups absent from the file retain their existing relative positions.

**Why:** Reusing an existing group without updating its position made correctly ordered imported rows appear in the old group's order.

**How to apply:** Apply participating group order and activity insertion atomically. Do not repair an older import by guessing from dates or names; compare against the original workbook before changing its existing order.
