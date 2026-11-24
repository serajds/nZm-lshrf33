# Image lifecycle: partial baseline, acceptance BLOCKED

This is not a completion report. Upload/read/print behavior in the running
application remains unchanged. Phase-two foundations are described separately;
they are not yet integrated. No production endpoint/database, existing image,
existing storage object or existing database schema was modified. Synthetic
objects and fresh private test databases were created for diagnostics and
cleaned. No production migration or deployment was started.

## Recovery and isolation

- A local Git recovery reference, `checkpoint/image-management-baseline-20261124`,
  was created at the unchanged baseline before edits. This is a source reference,
  not a database backup or a claim to have manually created a platform checkpoint.
- Development-only database callbacks confirmed access to the development
  database: 1,127 project files and 26 reports. Existing compression-job
  inventory was read only: one paused job. No jobs were resumed.
- Counts of report image/group references containing `data:image` were both zero
  in development. This is an inventory result, not proof the API rejects such
  references.
- **Storage isolation was subsequently verified for the test bucket.** The user
  supplied a separate development bucket; the storage benchmark and lifecycle
  fixtures refuse the application's default bucket. `fileStorage.ts` uses the configured
  bucket and `uploads/` prefix for both environments. A few derivative naming
  paths isolate development, not all writes. Official documentation explicitly
  says App Storage can be shared between development and production of an app:
  <https://docs.replit.com/features/data-and-storage/object-storage>.
  The actual page was checked because a search-generated summary incorrectly
  said the environments were always isolated.
- The storage experiment requires an explicitly separate development bucket.
  No bucket names, credentials, URLs with signatures, or user image content
  appear in the evidence.

## Discovered lifecycle inventory

| Area | Existing implementation and risk to verify |
|---|---|
| Report editor | `artifacts/construction-supervision/src/pages/projects/[id]/reports.tsx`, `handleImageUpload`: multipart XHR per image, unrestricted `Promise.all`, appends URLs in completion order, no optimization or cancellation/timeout |
| Public share upload | `pages/public-report-image-upload.tsx` and `routes/files.ts`: Base64/text/plain with progress/retry; existing admission/transaction lock and configurable per-share counter must survive consolidation |
| Files | `pages/projects/[id]/files.tsx`, `routes/files.ts`: generic files share persistence with report photos; image handling inferred from extension; non-image behavior is outside refactor scope |
| Initial persistence | `routes/files.ts`, `persistUploadedFile`: full-resolution quality-80 JPEG first; cloud failure or derivative failure can be caught while reporting success; strict durable option used only by a subset of calls |
| Variant processing | `lib/reportImageVariants.ts`: two active jobs, sixteen queued; initial upload encode occurs **outside** this queue; print policy 100KB/1000px, nested quality/size trials; thumbnail 640px |
| Derivative storage | `lib/reportImageVariantStorage.ts`: local, cloud and print-specific naming; production/development behavior differs by variant; preserve historical sources/URLs during migration |
| Protected reads | `app.ts`, `/api/uploads`: existing authorization; a stored-variant miss can invoke Sharp and persist a derivative **inside GET**; source fallback can return original bytes |
| Signed previews | `routes/reports.ts`, preview-assets route: report/project authorization, signed storage URL support; missing print derivative can sign the original, thus the UI may download a large original |
| Browser preview | `lib/report-preview-loader.ts`, `components/protected-image.tsx`: real progressive loader, bounded concurrency, preview-owned Blob URLs; preserve token-aware renewal and `private,no-store` |
| Browser HTML/PDF | `lib/report-pdf.ts`: actual printable design and image order; native `loading=lazy` interacts with explicit loading completion and print preparation |
| Server PDF | `routes/pdf.ts`, `resolveImagePath`: separate PDFKit consumer; original local/cloud files resolved to upload directory; does not automatically use the browser's optimized-image path |
| Logos | `routes/companies.ts`, `pages/companies.tsx`, `lib/report-logos.ts`: separate compression plus report-logo derivation; cloud failures caught; transparency must be preserved |
| Attendance web | `components/selfie-camera-dialog.tsx`, `lib/offline-attendance.ts`, `routes/attendance.ts`: local capture; multipart/Base64/offline forms; separate width-800 compression, double metadata inspection, local-only success possible |
| Attendance Expo | `artifacts/attendance-mobile/app/index.tsx`: ImageManipulator JPEG optimization already exists; preserve capture/offline/idempotency and independent rolling-session handler |
| Existing bulk workers | `lib/system-image-compression-worker.ts` and `report-image-optimization-jobs.ts`: distinct persisted workers inside API process; system worker schedules on import; do not import routes for a benchmark or resume paused work |
| Bulk inventory | `routes/system-image-compression.ts`, `collectAssets`, and `fileStorage.ts`, `listUploadedImageObjects`: scans whole tables/object listing; current system compressor can replace original objects and local files |
| References/contracts | `lib/db/src/schema/project_files.ts`, `reports.ts`, `lib/api-spec/openapi.yaml`, generated clients and share Zod policy: references and image groups/order/captions; no unified image lifecycle state yet |
| Cleanup | `report-image-cleanup.ts`, variant cleanup, logo/attendance delete paths: multiple reference owners; do not delete shared/historical originals during consolidation |
| Other readers | Owner routes and project company-logo endpoint consume the same references; retain their existing role/project visibility, not a new blanket image permission |

## Measured evidence

Repeatable tools: `scripts/image-audit/README.md`.
Final transport and processing experiments were executed sequentially. Earlier
exploratory runs overlapping other experiments were not used for the final
numbers below.

### Processing: same 4,260,235-byte synthetic high-detail JPEG

Real variant processor; initial JPEG encode reproduced exactly from the current
upload settings. Does not include filesystem upload, object storage or SQL.
Each batch ran in a separate process with a parent-side 700MiB/120s guard.

| Batch | Result | Elapsed | Peak RSS | Failure |
|---|---|---|---|---|
| 1 | PASS | 4.700s | 206.48MiB | none |
| 10 | PASS | 13.135s | 697.43MiB | none |
| 20 | FAIL | 28.570s | 656.08MiB | 2 derivative jobs rejected |
| 50 | BLOCKED | stopped by guard | 702.89MiB sampled | safety termination, not an observed production OOM |

Completed image p95 latencies: 4,699.73ms / 13,131.86ms / 28,566.53ms.
The last percentile excludes the two failed images; n is recorded explicitly.
This is per-image latency within one batch, **not** independent batch trials.
CPU user/system microseconds and complete RSS/heap/external samples are retained.
Event-loop p95 in these three batches was 10.36/10.49/10.54ms with a 10ms
histogram resolution. Native image CPU and memory pressure did not imply that
the JavaScript event loop was blocked for the whole encode.

The original stored-source re-encode still measured 3,850,585 bytes. The print
copy measured 81,575 bytes; thumbnail 25,535 bytes. The real existing derivative
processor made four encode calls per completed image in this case, in addition
to the initial upload re-encode. Synthetic noise is a stress input, not proof of
engineering detail quality.

### Transport: loopback HTTP only

Same bytes, same integrity check; rotated mode ordering; eight measured samples
per mode/fixture after excluding one warmup. Binary has less wire size and
local parsing overhead; **no transport change was adopted**.

For the 4,260,235-byte image:

| Transport | Body bytes | Round-trip p50/p95 |
|---|---|---|
| Base64/text/plain | 5,680,334 | 27.41 / 33.49ms |
| Binary | 4,260,235 | 13.89 / 24.27ms |
| Disk-backed multipart | 4,260,396 | 25.17 / 34.37ms |

Also measured 7,956,391-byte JPEG and 21,039,762-byte PNG. Fixture names are
descriptive labels, not exact byte sizes. The PNG is slightly larger than
20MiB and is deliberately not represented as an accepted report upload.
Temporary benchmark parser caps exceed app caps to isolate transport overhead;
these numbers do not imply the real report route accepts 8–21MB images.

Edge CSRF, missing Origin/Referer, PWA replay, real network shaping, application
authorization, direct-storage browser CORS and durable completion remain
unverified. Existing Base64 compatibility constraints are not disproven by a
loopback test.

### Browser and PDF

Real `buildPrintHTML` and `attachProgressiveReportImages`, synthetic HTTP JPEGs,
Chromium 155, 1280×900 and 390×844. No auth bypass or real report data.

- Text appeared after 120.7/29.7/32.4/42.9ms for desktop50/desktop100/mobile50/
  mobile100. Initial image requests were 8/8/6/6; max active asset requests 2.
- Cold desktop50: **FAIL**, print preparation stalled at 14 of 50 images for
  15 seconds without fetch errors. Changing only the test's native image loading
  to `eager` completed 50 images and invoked print after another 94.5ms.
  This is causal evidence for a native-lazy-load/slot interaction in this
  particular cold run, not a universal claim about every report.
- Subsequent cases: PASS, 100/50/100 images completed. They do not override the
  failed cold run.
- Actual Chromium PDF generation took 2,836ms after test-only recovery in the
  failed case, and 1,498/841/1,456ms in subsequent cases. The recovered output is
  explicitly named experimental, not a successful unmodified baseline.
- First render observed an 85ms long task; subsequent cases observed none in
  the measured window. No upload main-thread time was measured.
- V8 heap before/after cleanup and explicit GC is retained. Four cycles,
  emulated mobile and V8-only memory cannot prove absence of native/GPU leaks or
  replace a physical-device test.

### Database

Read-only development inventory: 1,127 files, 26 reports; zero inline image
references by the tested `data:image` pattern. `EXPLAIN (ANALYZE, BUFFERS)` of
an image count/size aggregate measured 0.648ms execution and 1.515ms planning,
with 31 shared blocks hit, zero data blocks read/written. This is a database
engine micro-measurement, not request/pool timings under mixed-user load.

## Confirmed versus unconfirmed

Confirmed locally: derivative queue rejections under the simulated upload
fan-out; large resource growth crossing the benchmark safety ceiling; additional
wire/parse cost of Base64; a cold native-lazy printing stall reversible by a
test-only intervention; initial text-first/viewport-limited loading works in
the synthetic browser cases. Source-proven risks include local-only upload
success, image conversion in reads, duplicated workers and original fallback.

**Not proven:** the cause of production termination, production OOM, deployed
transport compatibility, absence of leaks, full print quality, historical
migration safety, or any after-refactor improvement.

## Storage isolation and real HTTP update

The user explicitly designated a separate bucket through development-only
`IMAGE_AUDIT_BUCKET_ID`. Both probes refuse the configured application bucket.
The existing signer and storage SDK successfully uploaded, read back and
verified length/SHA-256. Chromium's signed cross-origin PUT returned HTTP 200.
The initial small-fixture signing/PUT/verification timings were 121.72 /
134.59 / 172.79ms; browser PUT was 110.20ms. These are single samples.

A subsequent fair comparison used the same 4,260,235-byte source, Chromium,
isolated bucket and read-back verification. Order rotated; nine cycles per
mode, first excluded (eight measured). Verified completion p50/p95:

| Transport | p50 ms | p95 ms | Preparation p95 ms | Failures |
|---|---:|---:|---:|---:|
| Base64/text/plain through private local proxy | 432.10 | 585.30 | 72.70 | 0 |
| Binary through the same proxy | 342.40 | 490.10 | 0 | 0 |
| Signed direct PUT | 344.40 | 373.90 | 0 | 0 |

Signing is timed separately/excluded; completion includes read-back SHA-256
verification. This is not a deployed-edge/PWA/application-authorization test.
All 27 transfers verified. Subsequent cleanup failed before object deletion;
the original diagnostic did not preserve the failure stage/code, so its exact
cause is unconfirmed. A bounded recovery verified the three reserved-prefix
objects' creation window, exact synthetic content and object generation before
deleting those three objects only. The cleanup evidence records recovery and
zero remaining failures. Future runs persist an exact cleanup ledger first and
do object cleanup even if browser cleanup fails. No bucket-wide deletion.

## Actual mixed-user baseline

`mixed.mjs` launches real authenticated routers with a fresh private PostgreSQL
cluster and the separate test bucket, not the existing database. Six synthetic
users run 50 concurrent multipart uploads plus report reads, project edits,
attendance writes, file browsing and PDFKit exports. The peer report is approved
and contains ten synthetic images. Client traffic generation runs outside the
API process so its image buffers are not attributed to server RSS.

The final valid run passed every idle route probe, then crossed the **same
700MiB safety guard** at 700.10MiB across the API process tree, after 17.65s
including setup/warmup. API-only peak was 688.38MiB; peak descendant count was
two processes including the compilation helper. Summed RSS is conservative
and can double-count shared pages; it is not unique physical memory/PSS.
No upload response completed before termination. API event-loop p95/max were
19.87/440.93ms; sampled process-tree CPU was 37.87 CPU-seconds. At most 15 SQL
queries were recorded per completed request. Raw
request query/pool/phase timings are retained without SQL text or parameters.

Idle p95 (8 samples each): files 22.19ms, report 102.00ms, PDF export 155.70ms,
project edit 157.96ms, attendance 261.52ms. Under-load completed requests
included delays above three seconds; an attendance completion took roughly
four seconds. The censored run and very small attendance sample do not
establish a reliable full-run tail distribution.

The raw observations are preserved. Summary version 2 excludes requests
cancelled by the safety guard from response-latency percentiles and counts them
separately, not as application-generated errors. No success/failure rate is
inferred for the full 50-image workload. Connection failures arriving before
the parent's abort notification are separately labelled unattributed transport
failures, never application HTTP errors; future guards signal clients before
killing the API to avoid this classification race. Cleanup recorded ten synthetic cloud
objects removed and no cleanup failures; the private database/local upload
directory was removed.

An intermediate sampler run was marked INVALID and retained separately: this
sandbox does not provide `/proc/PID/task/PID/children`. The corrected sampler
uses PPIDs from `/proc/PID/stat`, is tested with a real child, and fails closed
instead of turning sampling errors into zero RSS. The earlier API-only run is
also archived; it is not the process-tree comparison baseline.

## Gate decisions and remaining work

The storage setup blocker is closed. The baseline now reproduces a bounded
resource failure and other-service delays using real routes. This permits
building/testing the phase-two foundation; it does **not** accept upload,
transport replacement, print, device or full-workload criteria. Phase 2 is
partial, phases 3–9 remain unimplemented. No overall completion claim.

Before integrating phase 3: complete the phase-two service and contracts,
including durable storage verification, global admission, exact attempt-owned
keys and authenticated error mapping. Transport replacement is not approved
by prototype CORS results: authenticated completion, replay, edge and PWA checks
remain required. Multipart receive/parse time is not yet isolated inside actual
upload routes; browser image preparation/upload interaction is not yet measured.
Client-image policies remain the user-approved 1600px/150–350KB and
400px/15–50KB with documented quality exceptions, **not** the historical 100KB
print ceiling. Other consumers require their own profiles.

Hard criteria: zero missing derivatives on acknowledged success; no duplicates
or lost successes; 50-image run within the same resource guard; no heavy reads;
no incomplete export presented as complete. Before integration, set each
other-service under-load p95 ceiling to `max(100ms, 1.5 * measured idle p95)`:
files 100ms, report 153.00ms, export 233.54ms, edit 236.93ms, attendance 392.28ms.
These values use the final valid process-tree baseline; no post-change
performance run has yet been used to select or relax them.
Report sample counts and errors alongside every percentile; these are local
acceptance targets, not a claim about production latency. Compare the API
**and its image-worker process tree**, excluding the traffic generator, so
moving work into children cannot create a false memory improvement.
Full device/historical/
mixed-workload/restart/recovery checks and independent final verification
remain required.

The self-contained generated HTML report embeds the raw sanitized processing,
transport/browser/storage/mixed-workload observations. Large fixtures/PDFs/
evidence stay in the ignored `generated-artifacts/image-audit/` directory;
no original/user images or tokens are included.
