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
