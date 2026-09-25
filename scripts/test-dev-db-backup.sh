#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BACKUP_DIR="$ROOT/.local/dev-db-backups"
TMP=$(mktemp -d)
PORT=$((24000 + ($$ % 10000)))
ARCHIVE="roundtrip-test-$$.hdbkp"
FAULT_ARCHIVE="fault-roundtrip-test-$$.hdbkp"
PASS="disposable-integration-passphrase"
PGDATA="$TMP/pgdata"

cleanup() {
  if [[ -d "$PGDATA" ]]; then pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true; fi
  rm -f "$BACKUP_DIR/$ARCHIVE" "$BACKUP_DIR/corrupt-$ARCHIVE" "$BACKUP_DIR/$FAULT_ARCHIVE"
  rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR" "$TMP/socket" "$TMP/source-uploads" \
  "$TMP/source-objects/fixture-bucket/uploads" "$TMP/source-objects/private-bucket/prefix/public"
chmod 700 "$TMP" "$TMP/socket"
initdb -D "$PGDATA" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -o "-h 127.0.0.1 -p $PORT -k $TMP/socket" -l "$TMP/postgres.log" -w start >/dev/null

for database in source restored wrong corrupt unsuitable storage_unsuitable fault_restore describe_restore; do
  createdb -U "$(id -un)" -h 127.0.0.1 -p "$PORT" "$database"
done
SOURCE_URL="postgresql://$(id -un)@127.0.0.1:$PORT/source"
RESTORED_URL="postgresql://$(id -un)@127.0.0.1:$PORT/restored"
WRONG_URL="postgresql://$(id -un)@127.0.0.1:$PORT/wrong"
CORRUPT_URL="postgresql://$(id -un)@127.0.0.1:$PORT/corrupt"
UNSUITABLE_URL="postgresql://$(id -un)@127.0.0.1:$PORT/unsuitable"
STORAGE_UNSUITABLE_URL="postgresql://$(id -un)@127.0.0.1:$PORT/storage_unsuitable"
FAULT_URL="postgresql://$(id -un)@127.0.0.1:$PORT/fault_restore"
DESCRIBE_URL="postgresql://$(id -un)@127.0.0.1:$PORT/describe_restore"
psql --no-psqlrc --set ON_ERROR_STOP=1 "$SOURCE_URL" <<'SQL' >/dev/null
CREATE TABLE backup_fixture (value text NOT NULL);
INSERT INTO backup_fixture VALUES ('synthetic-round-trip-db-value');
SQL
printf 'synthetic-round-trip-local-file\n' > "$TMP/source-uploads/local.txt"
printf 'synthetic-round-trip-object-value\n' > "$TMP/source-objects/fixture-bucket/uploads/object-1"
printf 'synthetic-private-entity\n' > "$TMP/source-objects/private-bucket/prefix/direct-entity-id"
printf 'synthetic-public-overlap\n' > "$TMP/source-objects/private-bucket/prefix/public/object"

export NODE_ENV=development
export HARDENING_DEV_DATABASE_URL="$SOURCE_URL"
export HARDENING_DEV_EXPECTED_DATABASE="127.0.0.1/source"
export HARDENING_DEV_UPLOADS_DIR="$TMP/source-uploads"
export HARDENING_DEV_OBJECT_ADAPTER=local-dir
export HARDENING_DEV_OBJECT_ROOT="$TMP/source-objects"
export HARDENING_DEV_EXPECTED_OBJECT_SCOPES=fixture-bucket/uploads/,private-bucket/prefix/
export DEFAULT_OBJECT_STORAGE_BUCKET_ID=fixture-bucket
export PRIVATE_OBJECT_DIR=private-bucket/prefix
export PUBLIC_OBJECT_SEARCH_PATHS=private-bucket/prefix/public
unset DATABASE_URL PRODUCTION_DATABASE_URL EXTERNAL_DATABASE_URL
unset PRODUCTION_DEFAULT_OBJECT_STORAGE_BUCKET_ID PRODUCTION_PRIVATE_OBJECT_DIR \
  PRODUCTION_PUBLIC_OBJECT_SEARCH_PATHS

run_backup() {
  local archive=${1:-$ARCHIVE}
  { sleep 1; printf '%s\n' "$PASS"; sleep 1; printf '%s\n' "$PASS"; sleep 1; } |
    script -qefc "cd '$ROOT' && node scripts/dev-db-backup.mjs backup '$archive'" /dev/null
}
run_restore() {
  local pass=$1 url=$2 database=$3 uploads=$4 objects=$5 archive=$6
  { sleep 1; printf '%s\n' "$pass"; sleep 1; } |
    script -qefc "cd '$ROOT' && env HARDENING_DEV_DATABASE_URL='$url' HARDENING_DEV_EXPECTED_DATABASE='127.0.0.1/$database' HARDENING_DEV_UPLOADS_DIR='$uploads' HARDENING_DEV_OBJECT_ROOT='$objects' node scripts/dev-db-backup.mjs restore '$archive' --confirm-empty-development-database" /dev/null
}

mkdir -p "$TMP/fake-bin"
cat > "$TMP/fake-bin/gcloud" <<'FAKE_GCLOUD'
#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

(async () => {
const args = process.argv.slice(2);
const root = process.env.FAKE_GCLOUD_ROOT;
const uri = args.find((arg) => arg.startsWith("gs://")) || args.at(-1);
const match = typeof uri === "string" && uri.match(/^gs:\/\/([^/]+)\/(.+)$/);
const fail = (message, code = 1) => {
  process.stderr.write(message + "\n");
  process.exit(code);
};
const objectPath = (key) => path.join(root, ...key.split("/"));
const metaPath = (key) => path.join(root, ".fake-meta", Buffer.from(key).toString("hex") + ".json");
const readMetadata = (key) => {
  try { return JSON.parse(fs.readFileSync(metaPath(key), "utf8")); }
  catch { return { generation: "1", metadata: {} }; }
};

if (args[0] !== "storage") fail("fake gcloud supports storage only");
if (args[1] === "ls") {
  const listing = args.at(-1).match(/^gs:\/\/([^/]+)\/(.*)\*\*$/);
  if (!listing) fail("invalid listing path");
  const [, bucket, prefix] = listing;
  const base = path.join(root, bucket, ...prefix.split("/").filter(Boolean));
  const entries = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const current = path.join(dir, name);
      const stat = fs.statSync(current);
      if (stat.isDirectory()) walk(current);
      else {
        const key = path.relative(root, current).split(path.sep).join("/");
        const metadata = readMetadata(key);
        entries.push({
          url: "gs://" + key,
          size: stat.size,
          generation: metadata.generation,
          contentType: metadata.contentType,
          metadata: metadata.metadata,
        });
      }
    }
  };
  walk(base);
  process.stdout.write(JSON.stringify(entries));
} else if (args[1] === "cat") {
  if (!match || !fs.existsSync(objectPath(match[1] + "/" + match[2]))) fail("One or more URLs matched no objects.");
  await pipeline(fs.createReadStream(objectPath(match[1] + "/" + match[2])), process.stdout);
} else if (args[1] === "cp") {
  if (!match) fail("invalid object URL");
  const key = match[1] + "/" + match[2];
  const destination = objectPath(key);
  if (fs.existsSync(destination)) fail("precondition failed");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await pipeline(process.stdin, fs.createWriteStream(destination, { flags: "wx" }));
  const customArg = args.find((arg) => arg.startsWith("--custom-metadata=")) || "";
  const custom = {};
  for (const assignment of customArg.slice("--custom-metadata=".length).split(",")) {
    if (!assignment) continue;
    const split = assignment.indexOf("=");
    custom[assignment.slice(0, split)] = assignment.slice(split + 1);
  }
  fs.mkdirSync(path.dirname(metaPath(key)), { recursive: true });
  fs.writeFileSync(metaPath(key), JSON.stringify({
    generation: "7",
    contentType: (args.find((arg) => arg.startsWith("--content-type=")) || "").slice("--content-type=".length) || undefined,
    metadata: custom,
  }));
  if (process.env.FAKE_GCLOUD_FAIL_AFTER_WRITE === "1") fail("injected failure after object write", 9);
} else if (args[1] === "objects" && args[2] === "describe") {
  if (process.env.FAKE_GCLOUD_FAIL_DESCRIBE_ONCE === "1") {
    const marker = path.join(root, ".fail-describe-once");
    if (fs.existsSync(marker)) {
      fs.rmSync(marker);
      fail("injected one-time describe failure", 8);
    }
  }
  if (!match) fail("invalid object URL");
  const key = match[1] + "/" + match[2];
  if (!fs.existsSync(objectPath(key))) fail("One or more URLs matched no objects.");
  const stat = fs.statSync(objectPath(key));
  process.stdout.write(JSON.stringify({ ...readMetadata(key), size: stat.size }));
} else if (args[1] === "rm") {
  if (!match) fail("invalid object URL");
  const key = match[1] + "/" + match[2];
  if (!fs.existsSync(objectPath(key))) fail("One or more URLs matched no objects.");
  const generation = (args.find((arg) => arg.startsWith("--if-generation-match=")) || "").split("=")[1];
  if (generation !== readMetadata(key).generation) fail("generation precondition failed", 9);
  fs.rmSync(objectPath(key));
  fs.rmSync(metaPath(key), { force: true });
} else {
  fail("unsupported fake gcloud command");
}
})().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
FAKE_GCLOUD
chmod 700 "$TMP/fake-bin/gcloud"

run_backup
ARCHIVE_PATH="$BACKUP_DIR/$ARCHIVE"
test -s "$ARCHIVE_PATH"
if grep -a -q 'synthetic-round-trip' "$ARCHIVE_PATH"; then
  echo "Plaintext fixture content was found in the encrypted archive." >&2
  exit 1
fi

mkdir -p "$TMP/restored-uploads" "$TMP/restored-objects"
if run_restore "incorrect-integration-passphrase" "$WRONG_URL" wrong "$TMP/wrong-uploads" "$TMP/wrong-objects" "$ARCHIVE" >"$TMP/wrong.out" 2>&1; then
  echo "Wrong passphrase unexpectedly succeeded." >&2
  exit 1
fi
if psql --no-psqlrc --tuples-only "$WRONG_URL" -c "SELECT to_regclass('public.backup_fixture')" | grep -q backup_fixture; then
  echo "Wrong passphrase changed the target database." >&2
  exit 1
fi
test ! -e "$TMP/wrong-uploads/local.txt"
test ! -e "$TMP/wrong-objects/fixture-bucket/uploads/object-1"

run_restore "$PASS" "$RESTORED_URL" restored "$TMP/restored-uploads" "$TMP/restored-objects" "$ARCHIVE" >/dev/null 2>&1
VALUE=$(psql --no-psqlrc --tuples-only --no-align "$RESTORED_URL" -c "SELECT value FROM backup_fixture")
test "$VALUE" = "synthetic-round-trip-db-value"
cmp "$TMP/source-uploads/local.txt" "$TMP/restored-uploads/local.txt"
cmp "$TMP/source-objects/fixture-bucket/uploads/object-1" "$TMP/restored-objects/fixture-bucket/uploads/object-1"
cmp "$TMP/source-objects/private-bucket/prefix/direct-entity-id" "$TMP/restored-objects/private-bucket/prefix/direct-entity-id"
cmp "$TMP/source-objects/private-bucket/prefix/public/object" "$TMP/restored-objects/private-bucket/prefix/public/object"

cp "$ARCHIVE_PATH" "$BACKUP_DIR/corrupt-$ARCHIVE"
chmod 600 "$BACKUP_DIR/corrupt-$ARCHIVE"
printf X | dd of="$BACKUP_DIR/corrupt-$ARCHIVE" bs=1 seek=$(($(stat -c %s "$BACKUP_DIR/corrupt-$ARCHIVE") - 1)) conv=notrunc status=none
if run_restore "$PASS" "$CORRUPT_URL" corrupt "$TMP/corrupt-uploads" "$TMP/corrupt-objects" "corrupt-$ARCHIVE" >"$TMP/corrupt.out" 2>&1; then
  echo "Corrupted archive unexpectedly succeeded." >&2
  exit 1
fi
if psql --no-psqlrc --tuples-only "$CORRUPT_URL" -c "SELECT to_regclass('public.backup_fixture')" | grep -q backup_fixture; then
  echo "Corrupted archive changed the target database." >&2
  exit 1
fi

psql --no-psqlrc --set ON_ERROR_STOP=1 "$UNSUITABLE_URL" -c "CREATE TABLE preexisting (value text)" >/dev/null
if run_restore "$PASS" "$UNSUITABLE_URL" unsuitable "$TMP/unsuitable-uploads" "$TMP/unsuitable-objects" "$ARCHIVE" >"$TMP/unsuitable.out" 2>&1; then
  echo "Non-empty database unexpectedly accepted." >&2
  exit 1
fi
test "$(psql --no-psqlrc --tuples-only --no-align "$UNSUITABLE_URL" -c "SELECT count(*) FROM preexisting")" = "0"
test ! -e "$TMP/unsuitable-uploads/local.txt"
mkdir -p "$TMP/storage-target/fixture-bucket/uploads"
printf 'preexisting-object\n' > "$TMP/storage-target/fixture-bucket/uploads/keep"
if run_restore "$PASS" "$STORAGE_UNSUITABLE_URL" storage_unsuitable "$TMP/storage-uploads" "$TMP/storage-target" "$ARCHIVE" >"$TMP/storage.out" 2>&1; then
  echo "Non-empty Object Storage target unexpectedly accepted." >&2
  exit 1
fi
if psql --no-psqlrc --tuples-only "$STORAGE_UNSUITABLE_URL" -c "SELECT to_regclass('public.backup_fixture')" | grep -q backup_fixture; then
  echo "Non-empty Object Storage target caused a database restore." >&2
  exit 1
fi
test -f "$TMP/storage-target/fixture-bucket/uploads/keep"
test ! -e "$TMP/storage-uploads/local.txt"

mkdir -p "$TMP/fake-source" "$TMP/fake-target-partial" "$TMP/fake-target-describe"
cp -a "$TMP/source-objects/fixture-bucket" "$TMP/source-objects/private-bucket" "$TMP/fake-source/"
export PATH="$TMP/fake-bin:$PATH"
export HARDENING_DEV_OBJECT_ADAPTER=gcloud
export FAKE_GCLOUD_ROOT="$TMP/fake-source"
run_backup "$FAULT_ARCHIVE" >/dev/null 2>&1

export FAKE_GCLOUD_ROOT="$TMP/fake-target-partial"
export FAKE_GCLOUD_FAIL_AFTER_WRITE=1
if run_restore "$PASS" "$FAULT_URL" fault_restore "$TMP/fault-uploads" "$TMP/fake-target-partial" "$FAULT_ARCHIVE" >"$TMP/fault.out" 2>&1; then
  echo "Injected post-upload gcloud failure unexpectedly succeeded." >&2
  exit 1
fi
if test -e "$TMP/fake-target-partial/fixture-bucket/uploads/object-1"; then
  echo "Partially committed fake cloud object was not conditionally cleaned up." >&2
  exit 1
fi
if psql --no-psqlrc --tuples-only "$FAULT_URL" -c "SELECT to_regclass('public.backup_fixture')" | grep -q backup_fixture; then
  echo "Failed gcloud restore committed its database transaction." >&2
  exit 1
fi
test ! -e "$TMP/fault-uploads/local.txt"
if grep -qi "cleanup is uncertain" "$TMP/fault.out"; then
  echo "Cleanup uncertainty was reported despite successful conditional cleanup." >&2
  exit 1
fi

export FAKE_GCLOUD_ROOT="$TMP/fake-target-describe"
touch "$TMP/fake-target-describe/.fail-describe-once"
unset FAKE_GCLOUD_FAIL_AFTER_WRITE
export FAKE_GCLOUD_FAIL_DESCRIBE_ONCE=1
if run_restore "$PASS" "$DESCRIBE_URL" describe_restore "$TMP/describe-uploads" "$TMP/fake-target-describe" "$FAULT_ARCHIVE" >"$TMP/describe.out" 2>&1; then
  echo "Injected generation-description failure unexpectedly succeeded." >&2
  exit 1
fi
if test -e "$TMP/fake-target-describe/fixture-bucket/uploads/object-1"; then
  echo "Object created before generation-description failure was not cleaned." >&2
  exit 1
fi
if psql --no-psqlrc --tuples-only "$DESCRIBE_URL" -c "SELECT to_regclass('public.backup_fixture')" | grep -q backup_fixture; then
  echo "Generation-description failure committed its database transaction." >&2
  exit 1
fi
test ! -e "$TMP/describe-uploads/local.txt"
unset FAKE_GCLOUD_FAIL_DESCRIBE_ONCE

if compgen -G "$BACKUP_DIR/.restore-encrypted-*.tmp" >/dev/null ||
   compgen -G "$BACKUP_DIR/.restore-db-encrypted-*.tmp" >/dev/null ||
   compgen -G "$BACKUP_DIR/.service-*" >/dev/null ||
   compgen -G "$BACKUP_DIR/.pgpass-*" >/dev/null ||
   compgen -G "$BACKUP_DIR/$ARCHIVE.partial-*" >/dev/null; then
  echo "Temporary backup/restore files were not cleaned up." >&2
  exit 1
fi
echo "PASS: synthetic PostgreSQL/private-public object round-trip, wrong passphrase, corruption, unsuitable targets, cleanup, and fake-gcloud partial-upload/describe failures."