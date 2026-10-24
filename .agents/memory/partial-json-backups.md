---
name: Partial JSON backups
description: Safety principle for restoring project data from app-generated JSON exports.
---

Treat app-generated JSON exports as partial domain snapshots, not complete database snapshots. Before replacing projects, compare the exported tables with every current table that deleting projects will cascade into, and obtain a full database backup first. Make any omitted records explicit to the user before proceeding.

**Why:** A project import can appear successful while deletion permanently removes dependent records that the JSON export never contained. Database-level backups preserve a rollback path even when the application export is incomplete.

**How to apply:** For future project replacements or backup/restore work, inventory the live dependent tables and the export, obtain informed consent for missing data, and test the import in a rollback-only transaction before committing.

When a project-only restore preserves the existing audit log, compare it with the backup's audit history before declaring old progress unavailable. Do not merge audit records by numeric ID alone.

**Why:** A preserved development log represented an older timeline than the restored backup. The backup contained additional progress history, but some shared audit IDs referred to different events; development also contained a legitimate progress change made after the backup.

**How to apply:** Match event identity, activity lifetime, project and timestamps; isolate conflicts and preserve post-backup changes. Treat sparse audit progress as partial evidence, not a complete historical project state: missing initial weights, imports, deletions and linked-source history can prevent a reliable aggregate.