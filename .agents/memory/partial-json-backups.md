---
name: Partial JSON backups
description: Safety principle for restoring project data from app-generated JSON exports.
---

Treat app-generated JSON exports as partial domain snapshots, not complete database snapshots. Before replacing projects, compare the exported tables with every current table that deleting projects will cascade into, and obtain a full database backup first. Make any omitted records explicit to the user before proceeding.

**Why:** A project import can appear successful while deletion permanently removes dependent records that the JSON export never contained. Database-level backups preserve a rollback path even when the application export is incomplete.

**How to apply:** For future project replacements or backup/restore work, inventory the live dependent tables and the export, obtain informed consent for missing data, and test the import in a rollback-only transaction before committing.