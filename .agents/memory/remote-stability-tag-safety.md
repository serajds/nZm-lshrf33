---
name: Remote stability tag safety
description: Why a local stability tag is not automatically safe to push to a remote
---

Do not push historical stability tags or the current Git history to a remote until the reachable history has been checked for database snapshots and a safe export strategy has been agreed.

**Why:** The local history includes tracked database snapshots with credential-like fields. Removing those files only from the latest working tree does not remove them from commits reachable through an older tag.

**How to apply:** When asked for an external checkpoint, inspect history without printing sensitive values. Use a verified clean-history export or another access-controlled backup approach with explicit consent; do not treat a successful remote connection as permission to upload the old tag.