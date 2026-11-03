---
name: Report preview asset lifetime
description: Keep authenticated report assets scoped to the preview window and printable until it closes.
---

Report preview image reuse must stay local to one preview, not a shared cross-session cache. Blob URLs must live for the whole preview window lifetime, including replacing its loading document with the report and printing later.

**Why:** These are protected project photos and company logos. A shared cache could cross permission/session boundaries, while early revocation or cleanup on the opener's route change can break logos and photos in an already-open report.

**How to apply:** Retain preview-owned URLs until that window closes. When changing transport or cleanup, test decoding protected photos and logos after replacing the loading document, not only downloading them successfully.
