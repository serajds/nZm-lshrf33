# Development PostgreSQL backup and restore

This runbook uses PostgreSQL's native custom-format dump plus the app's local
uploads and configured Object Storage paths, packaged into one AES-256-GCM
encrypted offline bundle. Restore is allowed only to a verified empty
development database, uploads directory, and Object Storage scope. It does not
add an application restore endpoint or migrate/restore production.

## Scope and prerequisites

- Install PostgreSQL client tools compatible with the server (`pg_dump`,
  `pg_restore`, and `psql`).
- Install and configure `gcloud` for real Google Cloud Storage use. The CLI
  authenticates as the account active in its own configuration; app/Replit
  sidecar credentials are not automatically reused by this offline tool.
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
- Set `HARDENING_DEV_UPLOADS_DIR` to the **actual app uploads directory**. The
  server uses `path.join(process.cwd(), "uploads")`; when running the API server
  from `artifacts/api-server`, this is `artifacts/api-server/uploads`. Backups
  include regular files directly in that directory. Symlinks and nested
  directories are rejected rather than skipped.
- Select an object adapter explicitly with `HARDENING_DEV_OBJECT_ADAPTER`.
  `gcloud` uses the Google Cloud CLI and its independently configured
  credentials. For isolated local testing only, `local-dir` uses
  `HARDENING_DEV_OBJECT_ROOT` as a filesystem-backed object store. Never point
  either adapter at production resources.
- Set `HARDENING_DEV_EXPECTED_OBJECT_SCOPES` to the separately verified,
  comma-separated exact scope list (`bucket/prefix/`), sorted
  lexicographically; use `none` when the app has no configured object paths.
  The tool requires an exact match. Nested/overlapping app scopes are coalesced
  to their broadest prefix, and overlapping configured production scopes are
  rejected using `PRODUCTION_DEFAULT_OBJECT_STORAGE_BUCKET_ID`,
  `PRODUCTION_PRIVATE_OBJECT_DIR`, and `PRODUCTION_PUBLIC_OBJECT_SEARCH_PATHS`.
  A local-dir restore root must already exist as a real directory.
- Object scope comes from the app's storage configuration: the
  `uploads/` prefix in `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, the **entire**
  `PRIVATE_OBJECT_DIR` prefix (object entity paths can resolve directly under
  it), and each full prefix in
  `PUBLIC_OBJECT_SEARCH_PATHS`. `PRIVATE_OBJECT_DIR` and public paths use the
  app's `bucket/prefix` form. Overlapping scopes are unioned so each object is
  captured once. Only objects under these configured paths are bundled;
  unconfigured buckets and paths are outside coverage.

## Create a backup

After safely setting `HARDENING_DEV_DATABASE_URL` in the current development
shell using the secret manager (never paste the value into a command or log),
setting `HARDENING_DEV_EXPECTED_DATABASE` to the separately verified
development host/database identity, setting the local uploads path, and
choosing an explicitly isolated object adapter:

```sh
NODE_ENV=development \
HARDENING_DEV_UPLOADS_DIR=/path/to/api-server/uploads \
HARDENING_DEV_OBJECT_ADAPTER=gcloud \
HARDENING_DEV_EXPECTED_OBJECT_SCOPES=bucket-name/uploads/ \
node scripts/dev-db-backup.mjs backup
```

For an isolated local adapter, also set
`HARDENING_DEV_OBJECT_ROOT=/path/to/local/object-store`. The app environment
must contain the intended `DEFAULT_OBJECT_STORAGE_BUCKET_ID`,
`PRIVATE_OBJECT_DIR`, and/or `PUBLIC_OBJECT_SEARCH_PATHS` to capture those
paths. The bundle includes all regular files from the uploads directory and all
objects found in those configured Object Storage scopes.

Optionally pass a filename containing only letters, digits, dots, underscores,
and hyphens, ending in `.hdbkp`. The program creates a consistent PostgreSQL
custom-format dump, encrypts it, refuses to overwrite existing files, and does
not print connection information or database rows. The temporary libpq
connection files are removed after completion. Local uploads and cloud objects
are streamed into the encrypted bundle; no plaintext database dump or staged
object archive is written to disk.
The current bundle format is version 2; database-only `.hdbkp` files created by
the earlier version of this script must be restored with that earlier version
of the script in a disposable database.

## Restore into a fresh disposable development database

1. Provision a **new, empty, disposable development database**, an empty
   uploads directory, and empty isolated Object Storage prefixes. Do not reuse
   the running application's database or storage. Use the development DB URL
   as `HARDENING_DEV_DATABASE_URL`, set `NODE_ENV=development`, and set
   `HARDENING_DEV_EXPECTED_DATABASE` to that target's verified host/database
   identity. Point `HARDENING_DEV_UPLOADS_DIR` and the selected storage adapter
   at the corresponding fresh development file targets.
2. Verify through development-only controls that the selected DB and storage
   targets are the intended empty resources. The tool independently rejects
   non-empty DBs, uploads directories, or configured Object Storage scopes;
   compares the database target against known application/production URL
   variables; and never drops or cleans existing content.
3. Run the explicit confirmation command and enter the backup passphrase when
   prompted:

```sh
NODE_ENV=development node scripts/dev-db-backup.mjs restore dev-db-example.hdbkp --confirm-empty-development-database
```

Before connecting to the DB or writing any restore data, the tool copies the
archive to a randomly named, owner-only **encrypted** temporary snapshot and
authenticates the complete AES-GCM payload. During the second parse/decrypt pass,
local files and cloud objects are restored while the database dump is streamed
into a second, random-key **encrypted temporary spool**. Only after every bundle
record has been read and authenticated does the tool decrypt that spool directly
to `pg_restore`; there is no named plaintext database dump or archive. The
spool key remains in process memory, and `pg_restore` uses
`--single-transaction`. Restore targets must be empty and the snapshot ensures
both passes see identical encrypted bytes.

Local outputs and cloud objects whose ownership can be verified are cleaned up
if archive parsing, object transfer, or the DB transaction fails. Cloud uploads
use a unique per-run ownership marker and generation-conditional deletion. If
the CLI cannot prove ownership or confirm deletion, restore fails with an
explicit warning that the isolated cloud target must be inspected; it does not
blindly delete an uncertain object. The random marker remains as custom
metadata on successfully restored cloud objects and is ignored by the app.
Existing targets are never intentionally overwritten.
The temporary snapshot is removed on normal success or failure. A process crash
can leave only encrypted files (never a staged plaintext archive): the snapshot
and/or `.restore-db-encrypted-*.tmp` spool. The spool's ephemeral key is not
saved, so it cannot be recovered; the authenticated snapshot remains usable
with its passphrase. Inspect the filenames before removing crash leftovers.

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
- App uploads referenced as `/api/uploads/<filename>` are stored in the
  API server's `uploads/` directory and, when configured, in the
  `uploads/` prefix of `DEFAULT_OBJECT_STORAGE_BUCKET_ID`. Both local upload
  files and the configured object prefixes are included. Object entity paths
  `/objects/<id>` resolve anywhere below `PRIVATE_OBJECT_DIR`; the entire
  configured private prefix is included. Configured public search paths are included in
  full because DB rows may refer to files found there. The GCS adapter includes
  object content type and the app's `custom:aclPolicy` metadata in the encrypted
  bundle and requests those values on restore.
- This does **not** back up secrets, runtime configuration, global DB roles,
  unrelated buckets/prefixes, or external services. Keep runtime configuration
  and credentials separately. Do not treat data in unconfigured storage paths
  as covered.
- `gcloud` uses the credentials active in that CLI and has not been proven
  against a real bucket by the local fake-adapter test. Before using it on a
  genuine bucket, verify the exact configured scope and target using
  development-only cloud credentials. The `local-dir` adapter is for isolated
  tests/fixtures, not a production storage substitute.
- This tool deliberately has no in-place restore, production mode, destructive
  overwrite, remote upload, or automatic database creation.
- Retain encrypted backups and their passphrases separately on access-
  controlled, encrypted storage according to the organization's retention
  policy. Never commit a backup, passphrase, production dump, or connection URL.

## Safe smoke checks

The following integration test creates a disposable local PostgreSQL cluster
and filesystem-backed fake Object Storage adapter plus a fake `gcloud` CLI. It
tests a DB+file round trip including a direct private object path and overlapping
private/public prefixes, wrong passphrase, modified archive, non-empty
DB/storage targets, temporary-file cleanup, and injected cloud upload/metadata
lookup failures. It does not contact a real bucket:

```sh
bash scripts/test-dev-db-backup.sh
```

Without a provisioned disposable development target, validate only the
fail-closed guards:

```sh
env -u HARDENING_DEV_DATABASE_URL NODE_ENV=development \
  node scripts/dev-db-backup.mjs backup
```

This must fail before invoking PostgreSQL client tools or accessing a database.
A real restore test is valid only against a separate disposable development
database; never substitute production or an ambiguous shared application URL.