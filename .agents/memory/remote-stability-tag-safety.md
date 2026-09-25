---
name: Remote stability tag safety
description: Why a local stability tag is not automatically safe to push to a remote
---

Do not push historical stability tags or the current Git history to a remote until the reachable history has been checked for database snapshots and a safe export strategy has been agreed. A clean orphan-root branch only makes that new branch's ancestry safe; it does not cleanse existing remote refs.

**Why:** The local history includes tracked database snapshots with credential-like fields. Removing those files only from the latest working tree does not remove them from commits reachable through an older tag. The linked remote also had a reachable snapshot, so pushing a sanitized branch alone would leave its older exposed history intact.

**How to apply:** When asked for an external checkpoint, inspect history without printing sensitive values. Use a verified clean-history export or another access-controlled backup approach with explicit consent; do not treat a successful remote connection as permission to upload the old tag. Rewriting remote refs needs coordination with their owners; never force-update branches just to make a new checkpoint look clean.