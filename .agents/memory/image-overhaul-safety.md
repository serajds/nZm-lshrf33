---
name: Image overhaul safety and acceptance
description: Approved phase gates, consumer-specific policies, storage isolation and evidence requirements for the image overhaul
---

Implement the nine approved phases in order, testing each before the next,
without repeated development approvals. Publication, production writes,
production migration batches and original-image deletion require separate
explicit authorization.

**Why:** The user approved a full lifecycle rebuild, not another parallel
service or a recommendations-only audit, and explicitly separated development
permission from production permission.

**How to apply:** Consolidate correct existing functionality rather than
layering a second architecture. Use consumer-specific profiles for reports,
files, logos and attendance, preserve permissions and historical references,
and do not change the current share capacity as part of this work.

For report photos, the user approved these size targets: ordinary images
150–350 KB, high-detail images 350–600 KB, and documented technical exceptions
up to 1.5 MB. Thumbnails target 15–50 KB. Do not keep re-encoding fine detail
just to force an image under the ordinary range.

**Why:** The user supplied this as a binding update to the earlier 150–350 KB
target; construction details, text, wiring and low-light images may need more
bytes to remain usable.

**How to apply:** Select the report-image profile by use, retain the existing
1600 px/no-upscale/orientation requirements, and record why any exception was
needed instead of silently lowering quality.

Do not assume object storage is isolated just because the database is a
development database or NODE_ENV is development. Verify isolation before
running write/load/migration experiments. Check the actual App Storage
documentation page if a generated search summary claims the environments are
always isolated.

**Why:** The official page explicitly allows sharing App Storage between
development and production, while search-generated summaries contradicted it.
A fork and environment label alone do not prove which bucket inherited
configuration targets.

**How to apply:** Require an explicitly designated separate development bucket
for experiments; never test writes against inherited application storage
without proving isolation or obtaining the separate required authorization.

The user explicitly provided an independent bucket through development-only
`IMAGE_AUDIT_BUCKET_ID` for image experiments. That designation does not
authorize replacing application defaults or changing production configuration.

**Why:** It cleared the storage-isolation blocker, not the separate production
approval requirement.

**How to apply:** Keep experiment writes in that independently designated
bucket and retain the rejection guard against the application's bucket.

Compare backend CPU/RSS for the whole API-and-image-worker process tree;
exclude the load generator. Browser V8 heap does not include decoded-image
or GPU memory.

**Why:** Co-locating traffic generation with the API contaminated an early
resource result. Conversely, moving processing into child processes can
artificially lower API-only RSS without reducing total backend memory.

**How to apply:** Preserve process boundaries and equivalent resource accounting
in before/after acceptance, and label unmeasured native/browser memory clearly.

For image writes to the verified object-storage backend, use its CRC32C upload
validation plus a signed HEAD check for finalized generation, content type,
size, and the expected SHA-256 recorded as object metadata. Do not download every
successfully uploaded derivative solely to re-hash it.

**Why:** A 180-upload development test measured full readback verification at
221.9 ms p95 and 718.4 ms max; CRC32C plus HEAD measured 199.3–205.7 ms p95 and
352.9–370.4 ms max in two later runs. The optimization was tested against the
user-designated separate bucket, including rejection of a mismatched hash and
lost-ack recovery.

**How to apply:** Use this only where the storage backend confirms the upload
checksum and exposes the signed HEAD metadata tested here. Keep write success
gated on object existence and metadata matching; fail closed on mismatch.

The sandbox can expose `/proc/PID/status` and `/proc/PID/stat` but omit
`/proc/PID/task/PID/children`. Discover descendants through stat PPID relationships
instead, and stop a resource-guarded experiment if its sampler fails.

**Why:** Treating that missing file as an exited process silently produced zero
backend RSS. Such a run is invalid, not evidence of low memory.

**How to apply:** Test the sampler against a real child process before load;
retain invalid runs separately and never use them as acceptance baselines.

Record incomplete measurements as BLOCKED and failed acceptance as FAIL.
Source risks, local stress reproduction and production root causes are
different evidence classes. No comprehensive completion claim while essential
acceptance is failed or untested.

**Why:** The user explicitly rejects attributing a production crash to memory
without measurements, treating compilation as user acceptance, or hiding
unverified device/performance scenarios.

**How to apply:** Keep raw sanitized measurements, equivalent workloads,
per-stage p50/p95/resources, and distinguish genuine browser print completion
from forcing PDF generation through a browser automation command.

When a measured p95 acceptance run fails, continue architecture consolidation,
safe development migration, and signed-in synthetic-user verification before
repeating load tests. Do not rerun load tests randomly to obtain a passing result;
rerun after a justified change and preserve the original limits.

**Why:** The user explicitly reprioritized the remaining architecture,
migration, and real-user workflow work while retaining the existing p95
criteria and discouraging repeated reports or tests without a change.

**How to apply:** Work through remaining consumer paths and old job systems,
then complete isolated migration and browser flow checks. Return to p95 with
per-path evidence and a clear hypothesis; never use a passing retry to hide an
earlier failure.
