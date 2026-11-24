# Phase two foundation — private report entry integrated, overall partial

This is development work, not a completion/acceptance report. The private report
upload now uses the new coordinator, including transitional multipart clients.
Other entrances still use legacy processing. Only the additive image-assets
table/indexes were applied to the development database: zero assets, and the
same 26 existing reports at that phase-two snapshot. A separate reservation
table was added later for public-link upload recovery; see `phase-06.md`. No
existing image was rewritten or migrated.

## Later report-quality amendment

On 2026-11-24 the report client and shared policy gained three explicit
profiles: ordinary report images (150–350 KB), detailed engineering images
(350–600 KB), and user-declared technical exceptions (up to 1.5 MiB). All keep
the 1600 px/no-upscale/orientation rules. The report editor selects a profile
per image group; the technical choice is recorded as
`user_declared_technical_detail`. The image policy version is now 3.

Raster project-file images routed through both the dedicated image endpoint
and the older multipart endpoint now use the same lifecycle and receive a
400 px thumbnail. The older project-file compression path no longer performs
read/write-time report-image recompression.

Targeted real-worker, envelope, variant, storage and HTTP/JWT tests pass. A
5.36 MB synthetic detailed image and a 20.91 MB synthetic image with oversized
metadata were accepted using the technical profile; a 20.61 MB random-noise
image was rejected at the 1.5 MiB quality ceiling with no object write. These
are development fixtures, not evidence that real phone or HEIC/HEIF images work.

## Implemented and tested

- Shared, versioned profiles for reports (1600px), thumbnails (400px), logos
  (alpha-preserving PNG), attendance (800px JPEG), and file images (2400px,
  independently sized to avoid forcing report policy onto technical files).
- A one-job child-process executor: two active children maximum, one active
  per principal, three queued per principal and bounded overall queue.
  Paths cross into children, not large queued image buffers. Cancellation,
  timeout and independently sampled RSS limits terminate the child.
- Signature/decoder-based format checks, source size/pixel limits, metadata
  stripping, EXIF orientation, no enlargement, bounded encode attempts and
  explicit quality-floor/tiny-image exceptions. Unsupported HEIC decoders,
  corrupt input, animation and SVG fail explicitly; this does not alter
  existing SVG/logo routes yet.
- Session-level PostgreSQL admission shared by server instances. Incoming
  bodies/storage have three global slots, two per principal; native processing
  separately has two global slots, one per principal. This permits two upload
  requests to overlap network/native work without allowing one principal to
  occupy every slot. Upload leases precede parsing and last through storage;
  native leases cover only actual child work, not cloud waits.
- Persistent asset identity/state schema and a store with unique scoped
  idempotency keys, content-conflict rejection, atomic attempt claims,
  expiration/recovery, stale-attempt fencing and completeness constraints.
  Only references/dimensions/hashes/status are stored, never image bytes.
- Immutable, attempt-owned object keys and a lifecycle coordinator. Report
  success requires a primary, thumbnail and JPEG print companion, CRC32C-
  validated object writes, signed HEAD verification of size/type/generation
  and expected SHA-256 metadata, and one transactional file reference. Lost
  storage/COMMIT acknowledgements and partial failure are recovered without
  deleting published objects or duplicating the file row.
- Each asset records its bucket. Development coordinator writes use only the
  explicitly designated image-audit bucket, without replacing application
  defaults. Prior uncertain attempts retain their keys/bucket and a cleanup
  flag; there is no bucket-wide deletion or automatic original cleanup.
- Metadata-only variant resolution selects the recorded bucket and derivative
  without conversion or object writes. The protected upload reader, report
  preview signing and PDF JPEG selection recognize these new references.
  Legacy keys retain their old reader until its separate replacement phase.
- A pre-parser request adapter retains its PostgreSQL lease until cancelled
  work actually settles and removes only owned incoming temporary files.
  It is mounted before general parsers on the private Reports upload route,
  behind its existing project/Reports edit authorization.
- Processing/storage/commit phases feed existing request measurements. Child
  boot/wall time and sampled worker RSS are distinct from native processing.
  A worker exits if its owning API's IPC connection disappears.
- Native children inherit only an explicit runtime/environment allowlist, not
  database, object-storage or external API credentials. Prepared inputs are
  accepted without another encode only after metadata/dimension/size checks.
  Their above-target exception is distinguished from an encoder quality floor.
- JPEG fallback can reuse one primary/print object. Compensation for new owned
  objects has cancellable signing/deletion deadlines; non-image deletion is
  unchanged. Optional internal prepared-derivative paths are not a public API.
- Generated API models/client include the upload envelope, confirmed reference,
  quality exceptions and status recovery by persistent key. JSON and text/plain
  accept the same envelope; the client was exercised against the real router.
- Report-only members can view their own new report uploads and images actually
  referenced by a report in their authorized project, without gaining general
  Files access. Another member's unattached image remains inaccessible. No role
  or tab permission setting was modified.
- Legacy background compressors skip reserved new-image keys, so they cannot
  overwrite the coordinator's immutable outputs.

## Verification so far

`image-processing.test.mjs`: 8 passing tests using real Sharp child processes
covering profiles, EXIF, metadata, no enlargement, alpha, invalid content,
cancellation, fairness and deadline recovery.

`image-processing-admission.integration.test.mjs`: passed against a fresh
private PostgreSQL cluster using two independent pools. Checks shared global
capacity, per-principal exclusion, double release and cancellation recovery.

`image-asset-store.integration.test.mjs`: 5 passing TAP tests (parent + four
cases). Fifty simultaneous attempts create one identity; changed content is
rejected; incomplete success fails; retries reuse a ready result; expired
attempts recover; stale/terminal failures cannot publish a different outcome.
These are lifecycle tests, not proof of durable object storage.

`image-lifecycle.integration.test.mjs`: 9 passing TAP tests (parent + eight
cases) with real object storage in the designated separate bucket, private
PostgreSQL, and SDK guards refusing the application bucket. Covers verified
three-variant storage, idempotent retry, lost acknowledgements, partial failure,
transaction rollback, cancellation, metadata-only reads and JPEG print reuse. Exact test-owned
objects were cleaned up with no reported cleanup failures.

`image-upload-request.integration.test.mjs`: passed using real HTTP/JWT and
private PostgreSQL. Unauthorized/excess same-user uploads never reach parsing;
another user retains capacity. Aborting the connection does not release the
global lease until the held work settles and its temporary input is removed.

`report-image-upload-http.integration.test.mjs`: 7 passing TAP tests using real
HTTP/JWT, the generated client, private PostgreSQL and the designated separate
bucket. Includes content validation, idempotent response recovery/status,
multipart compatibility, protected thumbnail streaming and Reports-only access
without exposing unattached project files.

The signal test confirms that losing admission stops an unfinished request
body before releasing held work. The two-pool admission test also terminates
an actual PostgreSQL session and checks abort, reacquisition and stale cleanup.

The first foundation pass recorded 60 tests. The latest combined regression run
passed **74 tests with zero failures**; 2 opt-in PostgreSQL lock/restart tests
were skipped because their separate run flags were not enabled. Raw output is in
the ignored diagnostic directory. Workspace types, API/web builds and the
attendance-mobile typecheck passed. Both API and web workflows restarted. The
unauthenticated login page rendered without browser errors; the signed-in image
screens remain unverified in the preview.

The worker has a separate build entry and imports no database/storage modules;
its runtime environment excludes credentials. This is not an OS sandbox.
No new external infrastructure was added. These checks are not a final load,
device, migration or production acceptance.

## Required before this phase is complete

- Integrate remaining public and other consumer entrances in their ordered
  phases; a private-entry result is not evidence that all consumers migrated.
- Complete crash/restart recovery and whole-application failure scenarios.
- Complete backend process-tree measurements; an API-only RSS reduction after
  forking is not a verified total memory reduction.

Do not describe this foundation as a unified live pipeline or proceed as if
steps 3–9 had passed. Existing workers/read-time transformations remain until
their ordered integration phases prove they can be retired safely.
