---
name: Development database schema drift
description: Avoid unsafe broad schema push when Drizzle detects unrelated constraints in the existing development database.
---

When applying a focused database feature to development, first inspect what a broad Drizzle schema push proposes. If it asks to truncate an unrelated populated table or stops at an unrelated constraint prompt, do not force the push; apply the reviewed feature migration narrowly and verify its columns and indexes afterward.

**Why:** A noninteractive push encountered an unrelated uniqueness constraint on an existing populated table and did not apply the intended feature columns. Assuming success would leave the API running against an old schema; accepting the truncate option would risk data loss.

**How to apply:** For schema work on this mature project, inspect push output and confirm the actual development schema independently before testing routes. Keep production schema changes within the project's publish migration process.