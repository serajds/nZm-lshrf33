---
name: PDF rendering across browser realms
description: html2pdf iframe compatibility and reliable downloads
---
When rendering PDFs with html2pdf in an isolated iframe, create options in the iframe's realm and download the resulting Blob from the parent document.

**Why:** Cross-realm arrays fail the library's margin validation. Its deferred save can also be cancelled when the iframe is removed, even though the returned promise resolves.

**How to apply:** Serialize options through the iframe's JSON parser, request Blob output, and keep the parent's object URL alive briefly after clicking its download anchor. Verify actual downloaded bytes in a browser test, not merely promise resolution.