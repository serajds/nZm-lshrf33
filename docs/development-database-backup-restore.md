# Development PostgreSQL backup and restore

This runbook uses PostgreSQL's native custom-format dump, encrypted with
AES-256-GCM, and restores only to a verified empty development database. It is
intentionally an offline CLI tool; it does not add an application restore
endpoint or migrate/restore production.

## Scope and prerequisites

- Install PostgreSQL client tools compatible with the server (`pg_dump`,
  `pg_restore`, and `psql`).
- Provision a **separate, disposable development PostgreSQL database**. Get its
  connection URL from the development secret manager; do not copy a production
  URL or put a URL in shell history, code, a report, or a ticket.
- The URL must be supplied as `HARDENING_DEV_DATABASE_URL`. The tool refuses to
  run unless `NODE_ENV=development`, refuses the regular `DATABASE_URL` as a
  fallback, and rejects a target URL that exactly matches an available
  `DATABASE_URL`, `PRODUCTION_DATABASE_URL`, or `EXTERNAL_DATABASE_URL`.
- Also set `HARDENING_DEV_EXPECTED_DATABASE` to the verified
  `hostname/database-name` identity of the disposable development database
  (without credentials). The tool requires an exact match and rejects a
  host/database identity shared with the known application/production URL
  variables, even if credentials differ.
- Backups are written only under `.local/dev-db-backups/`, which is Git-ignored.
  Files have owner-only permissions (`0600`); the containing directory is
  `0700`. Temporary libpq connection and password files are also `0600` and
  removed at exit. Encryption passphrases are entered interactively without
  echo and are never saved. Preserve the passphrase independently; it cannot
  be recovered.

## Create a backup

After safely setting `HARDENING_DEV_DATABASE_URL` in the current development
shell using the secret manager (never paste the value into a command or log),
and setting `HARDENING_DEV_EXPECTED_DATABASE` to the separately verified
development host/database identity:

```sh
NODE_ENV=development node scripts/dev-db-backup.mjs backup
```

Optionally pass a filename containing only letters, digits, dots, underscores,
and hyphens, ending in `.hdbkp`. The program creates a consistent PostgreSQL
custom-format dump, encrypts it, refuses to overwrite existing files, and does
not print connection information or database rows.

## Restore into a fresh disposable development database

1. Provision a **new, empty, disposable development database**. Do not reuse
   the running application's database. Use that database's URL as
   `HARDENING_DEV_DATABASE_URL`; set `NODE_ENV=development` and set
   `HARDENING_DEV_EXPECTED_DATABASE` to that target's verified host/database
   identity.
2. Verify through your provider's development-only console that the selected
   target is the intended empty database. The tool independently rejects
   non-empty targets, compares the target against known application/production
   URL variables, and never drops or cleans an existing database.
3. Run the explicit confirmation command and enter the backup passphrase when
   prompted:

```sh
NODE_ENV=development node scripts/dev-db-backup.mjs restore dev-db-example.hdbkp --confirm-empty-development-database
```

Before connecting to the target, the tool authenticates the entire encrypted
archive by copying it to a randomly named, owner-only **encrypted** temporary
snapshot and streaming decrypted bytes from that snapshot to a discard sink.
It then decrypts a second time directly to `pg_restore` stdin; no named
plaintext dump is created. `pg_restore` stdin is not closed until AES-GCM
authentication succeeds. If second-pass authentication/input fails, the
restore process is stopped.
`pg_restore` runs with `--single-transaction`, so an unsuccessful restore rolls
back instead of leaving a partial schema/data import.
The temporary snapshot is removed on normal success or failure. A process crash
can leave only that encrypted snapshot (never decrypted database contents);
it contains no stored passphrase and can be deleted after confirming its
`.restore-encrypted-*.tmp` name.

The tool checks target emptiness after archive authentication and immediately
again before starting `pg_restore`. A small race remains between that final
query and the restore connection: PostgreSQL cannot reserve a completely empty
database against arbitrary clients through this offline two-connection flow.
The operator must therefore use a newly provisioned, isolated development
database with no application or other clients connected. The single transaction
provides all-or-nothing restore behavior, but is not an exclusivity lock against
other clients.

## Coverage and known limits

- `pg_dump` includes PostgreSQL schema and application-table data in the
  selected database, including constraints and indexes. Global PostgreSQL
  roles and server configuration are not included; `--no-owner --no-acl`
  restores objects under the target database owner.
- This does **not** back up uploaded files or Object Storage objects, secrets,
  runtime configuration, or external services. Database rows may refer to
  files that need their own separately tested, encrypted object-storage backup
  and restore process. Do not treat a database dump alone as a full-system
  disaster-recovery backup.
- This tool deliberately has no in-place restore, production mode, destructive
  overwrite, remote upload, or automatic database creation.
- Retain encrypted backups and their passphrases separately on access-
  controlled, encrypted storage according to the organization's retention
  policy. Never commit a backup, passphrase, production dump, or connection URL.

## Safe smoke checks

Without a provisioned disposable development target, validate only the
fail-closed guards:

```sh
env -u HARDENING_DEV_DATABASE_URL NODE_ENV=development \
  node scripts/dev-db-backup.mjs backup
```

This must fail before invoking PostgreSQL client tools or accessing a database.
A real restore test is valid only against a separate disposable development
database; never substitute production or an ambiguous shared application URL.