# Phase five — export path, partial

The browser report preview now shows lazy 400-pixel thumbnails, loads the
JPEG report/print variant when a person zooms or requests printing, and limits
image preparation to two active tasks. Print/export waits for the image set.
If any image fails, the preview names the number of failed images, does not
open the print dialog, and offers the same button as a retry action.

The direct server PDF endpoint preloads each report's images with one active
validation/download at a time before it sends PDF headers. It uses the stored
JPEG print copy for managed assets, checks file size, dimensions and supported
PDF formats, fully decodes with bounded pixel limits, and preserves group
order/category headings. Missing or invalid images return a specific JSON
503 before any PDF body is sent; the endpoint no longer skips missing or
undecodable pictures and returns a partial file as success.

Verification in private HTTP/DB/storage fixtures generated an actual PDF
containing the prepared print image, then verified a missing-image export
returns `report_pdf_image_unavailable` with JSON rather than a PDF header.
Preview-loader tests verify first-load thumbnails, image zoom loading the
report variant on demand, retry after a temporary print-image failure, and
bounded concurrency.

Not yet accepted: comparison of print-image detail against historic originals,
multiple report/group images with verified visual order and comments, large
PDF export memory/throughput, report logos and signatures under full output,
long-running print-window/resource lifecycle, and 50/100-image real browser
printing. Preflight's single-image native decode and direct PDF document
buffering still require resource measurement under large exports.
