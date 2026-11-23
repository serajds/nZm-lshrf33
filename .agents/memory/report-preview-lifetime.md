---
name: Report preview asset lifetime
description: Keep authenticated report assets scoped to the preview window and printable until it closes.
---

Browser-side report preview image reuse must stay local to one preview, not a shared cross-session cache. Blob URLs must live for the whole preview window lifetime, including replacing its loading document with the report and printing later.

**Why:** These are protected project photos and company logos. A shared cache could cross permission/session boundaries, while early revocation or cleanup on the opener's route change can break logos and photos in an already-open report.

**How to apply:** Retain preview-owned URLs until that window closes. When changing transport or cleanup, test decoding protected photos and logos after replacing the loading document, not only downloading them successfully.

Server-side derived image reuse is acceptable only behind the original file's authorization check on every request. Keep protected HTTP responses private and no-store. Preserve originals and report snapshots. Durable preview derivatives may be stored only as a deliberate, user-approved optimization, and must be removed with their source.

**Why:** Repeated on-demand resizing adds CPU and memory pressure during report previews. The user approved a separate stored preview copy to avoid repeating that work, while keeping the original image unchanged.

**How to apply:** Generate separate photo and transparency-preserving logo variants, leave original download links intact, key each derivative to its immutable upload source, and never serve it before checking access to that source. Do not persist derivatives to shared storage as an incidental development optimization.

Validate image transport changes through the actual report HTML builder, including its URL sanitization, not a hand-written page of image tags.

**Why:** A successful download and blob decode can still produce a report with no photos if the final template rejects that URL scheme. A synthetic image-only browser page previously missed exactly this regression.

**How to apply:** Assert expected photo and logo counts and successful decoding after rendering the real report, with both grouped and legacy photo inputs. Keep unsafe URL schemes rejected.

For the Development-only direct-storage preview experiment, mint short-lived signed GET URLs only after checking access to the report and confirming each image filename belongs uniquely to that same project. Do not send the user's app bearer token to object storage, persist signed URLs, or enable this path in production without explicit approval.

**Why:** Reports with many photos can generate a large number of per-image API authorization requests. Signed storage reads can bypass those repeated API checks, but each URL is a temporary bearer capability.

**How to apply:** Keep the endpoint report-scoped, project-file-scoped, no-store, and short-lived; fetch signed URLs without credentials, convert to preview-owned Blob URLs, and gate both client and server to Development until the user authorizes broader use.

Treat direct signed reads as a transport/load mitigation, not proof of the cause of an API crash. A `SIGKILL` after image requests does not establish OOM unless memory or runtime evidence ties the termination to image processing.

**Why:** Production logs showed successful image responses followed by a process kill, while memory metrics and image-variant cache-hit data were unavailable.

**How to apply:** Before claiming a root fix, measure per-image variant hits/misses, cloud read/encode time, active Sharp jobs, and process RSS in Development using the same report pattern; keep the production termination cause explicitly unconfirmed until evidenced.

Adding derivative generation to the upload path does not create derivatives for files that already exist. Do not synchronously transform a batch of legacy report images in the API during preview; account for cold-cache files separately.

**Why:** Older shared-report photos were uploaded before derivative persistence was added, so the first preview invoked lazy Sharp transforms against the API process.

**How to apply:** Test a cold report with many old images before deployment. Use bounded, observable backfill or serve the original safely while derivatives are prepared; verify hits/misses and RSS before declaring the issue resolved.

The approved image-optimization target is a separate JPEG copy no larger than 100 KB for small-grid print layouts. Preserve original uploads, report records, and snapshots; legacy backfill is opt-in and Development-gated.

**Why:** The user wants existing and future report photos to load and print lightly without changing historical source data, and only approved testing in Development so far.

**How to apply:** For legacy photos, add environment-scoped derivatives and leave source URLs and database rows unchanged. Generate the same bounded copy for future uploads. Keep signed-link delivery and the legacy backfill action Development-only until the user separately authorizes Production behavior.
