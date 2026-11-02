---
name: Manual principal group classification
description: User-approved bulk workflow and the boundary between index classification and actual schedule groups.
---

The user approved manually placing several existing groups under a principal category using a fast bulk-selection workflow: search, select multiple groups, choose an existing category or create one, then save once.

**Why:** The group index becomes difficult to use on large projects. The user explicitly wanted something practical and quick, not editing each group individually.

**How to apply:** Keep exactly two navigation levels: principal category, then existing group. Unclassified groups remain accessible, and changing a principal filter resets the secondary filter.

Classification organizes the index only. It must not merge schedule groups, move activities between groups, alter weights/progress/schedules, change source ownership, or propagate classifications to other projects.

**Why:** The approved feature is filtering and organization, not a change in the schedule's calculation or linked-source model.

**How to apply:** Preserve underlying group identity, authorization, source links and report data. Deleting a principal category releases its groups to unclassified; it never deletes groups or activities.
