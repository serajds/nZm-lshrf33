---
name: Report print image budget
description: Safety policy for image payloads loaded into a printable report preview.
---

Before issuing report-preview image links, inspect the exact target copy's storage size and content type. Accept JPEG, PNG, and WebP only; cap each image at 8 MiB and the report's aggregate at 32 MiB. If any target fails inspection or the aggregate is exceeded, fail the whole preview with a retryable message instead of issuing partial links.

**Why:** The preview keeps image blobs alive until printing, and historical or `file_image` originals can be much larger than regular report derivatives. A total byte ceiling prevents a large report from exhausting browser memory.

**How to apply:** For managed images, resolve and inspect the ready print key without falling back to the primary. For legacy images, prefer a validated print derivative, then inspect any exact original or saved report-photo copy selected. Keep source files and report references unchanged.
