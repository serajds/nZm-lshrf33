---
name: Large report PDF generation
description: Reliable PDF generation for reports containing many protected photos
---
Generate photo-heavy report PDFs on the API server and stream single-report output without buffering all pages.

**Why:** Browser HTML-to-canvas generation exhausts canvas or memory limits when a report contains hundreds of photos. Buffering every PDF page server-side recreates the same memory risk.

**How to apply:** Fetch the authenticated PDF as a Blob for download, resolve protected photos sequentially on the server, and disable PDF page buffering for individual-report exports. Test with a real large report and verify status, MIME type, size, and `%PDF-` bytes.