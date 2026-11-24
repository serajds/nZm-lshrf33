# Image lifecycle performance evidence

These development-only experiments use deterministic synthetic images. They do
not open application routes, import route modules that start maintenance jobs,
read user images, touch database rows or write to the configured object bucket.
Output and synthetic fixtures are under the ignored
`generated-artifacts/image-audit/` directory.

Run from the workspace root:

```sh
node scripts/image-audit/transport.mjs
node scripts/image-audit/baseline.mjs
node scripts/image-audit/browser.mjs
node --test scripts/image-audit/common.test.mjs
NODE_ENV=development node --import ./scripts/node_modules/tsx/dist/loader.mjs scripts/image-audit/legacy-inventory.mjs
NODE_ENV=development REPORT_IMAGE_UPLOAD_BROWSER=1 node --import ./scripts/node_modules/tsx/dist/loader.mjs --test tests/report-image-upload.browser.test.mjs
NODE_ENV=development node --import ./scripts/node_modules/tsx/dist/loader.mjs scripts/image-audit/migrate-legacy-images.mjs --project PROJECT_ID --dry-run
node scripts/image-audit/report.mjs
```

Run measurement commands sequentially, with no other benchmark/build running,
to avoid introducing CPU/memory contention between experiments.
The browser command needs an isolated headless Chromium instance listening on
DevTools port 9222. It opens and closes its own target, serves only synthetic
fixtures on an ephemeral loopback port, uses the real report template/loader,
and generates real PDFs without changing app authentication.
If native lazy loading prevents the application's print preparation from
finishing within 15 seconds, the baseline case is recorded as FAIL. A test-only
`loading=eager` intervention probes that failure; any resulting PDF is explicitly
named experimental recovery and does not turn the baseline into PASS.

The report command runs after the other probes and produces one self-contained
Arabic HTML file embedding the raw numerical evidence, with no fixture images,
user content or access URLs. Its explanatory text describes the recorded initial
baseline, not a generic acceptance checker for a future refactored implementation.

`node scripts/image-audit/storage.mjs` exits with code 2 and records `BLOCKED`
unless a **separate development-only bucket** is explicitly configured as
`IMAGE_AUDIT_BUCKET_ID`. It refuses the application's configured bucket. With
an isolated bucket, it checks a signed PUT against metadata and SHA-256, tests
an actual Chromium CORS upload and removes only its own randomly named test
object. This does not establish application authorization or deployment-edge
compatibility. Do not supply the application's production bucket as a test
bucket.

The transport experiment compares the same bytes over Base64/text/plain JSON,
binary and disk-backed multipart, rotates execution order and excludes the
first cycle from percentile summaries. It verifies SHA-256 equality after
parsing. It **does not** test the deployed edge, authentication, PWA replay,
signed URLs or storage durability. Never choose production transport from this
microbenchmark alone.

The processing experiment runs each 1/10/20/50 batch in a separate process,
uses the real existing variant processor, and reproduces the initial full-size
JPEG conversion from `files.ts`. It records per-image latency, CPU, event-loop
delay and sampled process memory. Object storage and database time are
**not included**. The parent samples `/proc` independently of the child event
loop and kills a child above 700 MiB RSS or 120 seconds. Such a result is
`BLOCKED`, not a successful test or proof of an out-of-memory production crash.
The source/fixture limits, Node version and source revision are in the output.

Synthetic noise is intentionally a repeatable high-detail stress input. It is
not a representative photograph or a visual engineering-quality assessment.
Do not interpret a smaller image as acceptable without comparing real details.

`NODE_ENV=development node scripts/image-audit/storage-transport.mjs` compares
Base64/text, binary proxy and direct signed PUT from the same private Chromium
instance with the same source/bucket and SHA-256 completion verification.
Signing is recorded separately. It creates a cleanup ledger before writes.
It is not an authenticated application endpoint or deployed-edge experiment.

`NODE_ENV=development node scripts/image-audit/mixed.mjs` creates its own fresh
private PostgreSQL cluster and private upload directory, temporarily points
only its child at the explicitly separate bucket, and exercises real routers
with six synthetic users. The traffic generator is outside the measured API
process. A 700MiB/120s guard can abort the run; guard cancellations are recorded
separately from HTTP errors/latency. Cleanup deletes only exact SDK-recorded
synthetic keys, never a bucket sweep.

`legacy-inventory.mjs` is a read-only aggregate over the development database.
It deliberately does not list or read object-storage files, so its counts do
not prove that every referenced object exists and cannot identify content-level
duplicates or orphan objects. It writes only aggregate metadata to the ignored
generated-artifacts directory.

`migrate-legacy-images.mjs` is stricter: it requires development mode, blocks a
deployed process, and refuses every bucket except the distinct
`IMAGE_AUDIT_BUCKET_ID`. It pages project-file image rows, defaults to a
read-only metadata dry run, and only processes images when an explicit
`--sample 1..3` is supplied. The sample is idempotent through the image-asset
records, preserves the old project-file URL and source object, and emits a
rollback map; it does not update references or delete originals. It is a
synthetic/isolated validation tool, not authorization to scan the application's
default bucket or to migrate existing user images.

`tests/report-image-upload.browser.test.mjs` is an opt-in real UI/API flow. It
creates a private database and synthetic admin session, and refuses storage
access outside the isolated audit bucket. In the signed-in report UI it selects
1, 10, 20 and 50 local synthetic JPEGs, each source 5–20 MiB, exercises local
preparation and the two-slot queue, checks HTTP completion and saved ordering,
opens each report, and for the 50-image case loads thumbnails, zooms a prepared
photo and waits for all print-photo variants before intercepting the browser's
print dialog. It then edits the report and confirms image references remain
ordered. Cleanup removes and verifies only exact keys recorded in the private
test database; a failure also writes a cleanup outcome file. Images are
synthetic and repeated source patterns, so this test does not assess real
construction-detail quality. It is a desktop Chromium test, not a mobile,
PWA, deployed-edge, or physical-device test.

Do not commit generated images or credentials. Small sanitized numerical
evidence can be copied to `docs/image-management/` for a reviewable record.
