---
name: Development database schema drift
description: Avoid unsafe broad schema push when Drizzle detects unrelated constraints in the existing development database.
---

When applying a focused database feature to development, first inspect what a broad Drizzle schema push proposes. If it asks to truncate an unrelated populated table or stops at an unrelated constraint prompt, do not force the push; apply the reviewed feature migration narrowly and verify its columns and indexes afterward.

A table declared in Drizzle source is not proof that it exists in the development database. Publish compares the actual development and production databases, so a new API query can fail in production if the dev database never received the table. If Drizzle suggests renaming a backup table to satisfy a new table, preserve the backup and add the new table instead.

**Why:** Noninteractive pushes can stop on unrelated constraints, and source schema can drift from the actual databases. A reports endpoint recently returned 5xx because a required image-sharing table was missing in both databases; a backup-table rename suggestion would not have been the correct repair.

**How to apply:** For schema work on this mature project, inspect push output and verify the actual development schema before testing routes. Use an additive feature migration when a backup table is only a rename candidate. Keep production schema changes within the project's publish migration process.