---
name: Sequence ownership in Publish diffs
description: Diagnose duplicate PostgreSQL sequence creation caused by missing ownership metadata.
---

A `nextval(...)` column default does not by itself make a PostgreSQL sequence owned by that column. The catalog must also record the automatic dependency created by `ALTER SEQUENCE ... OWNED BY table.id`. A development sequence can therefore exist and serve inserts while Publish still treats it as new, because the production sequence is owned and the development one is not.

**Why:** A database restore can recreate sequences and column defaults but omit sequence ownership. The resulting development-to-production diff may try to create a sequence that already exists in production and fail with “relation already exists.”

**How to apply:** Compare sequence existence, ownership, column types, and defaults in development and production. If only development ownership is missing, attach each existing sequence to its matching ID column in development, then recompute the schema diff. Do not change production directly or bypass Publish.
