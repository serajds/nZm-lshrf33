# Phase four — read path, partial

New managed report images are resolved using database metadata and the asset's
own recorded storage bucket. The protected image endpoint streams the selected
object; it does not decode, resize, write derivatives, or change readiness
state. The report preview endpoint keeps the protected application URL for new
images, so thumbnail and report/print requests are separately checked by the
existing upload authorization gate. A report-only member can see only images
actually referenced by that project report or the member's own new upload;
general Files access is unchanged.

Legacy reports retain their historical URLs. If an older saved preview
derivative exists, reads can stream it. On a legacy cache miss, the endpoint
streams the original source rather than starting Sharp inside the GET request.
If that source is absent, the endpoint returns an explicit `image_variant_missing`
404; it does not claim the report is complete or run expensive conversion.
This fallback can send a full-sized legacy source to a screen and is a temporary
compatibility cost, not proof that those old images are optimized.

The old cold-read conversion branch was removed from the main API image route.
The older variant helpers and queued maintenance code are not yet retired:
other report/print and migration dependencies must be traced and safely moved
in their later ordered phases.

Verification includes the existing report preview loader tests; a new real
protected-read integration test checks that a legacy thumbnail cache miss
streams byte-for-byte identical source data and creates no derivative. Managed
asset resolution tests verify that screen/report-photo selection uses the
recorded report print JPEG while thumbnails use the 400-pixel stored variant.
These are local fixture tests, not signed-in visual acceptance of cold,
historical 50/100-image reports.

Still blocked: real signed-in preview navigation under 50 and 100 images,
repeated cold-cache open/close memory checks, browser image/GPU memory, page
virtualization need, mobile behavior, and full PDFs with historical missing
assets. A missing historical source is surfaced as an error; migration is
separate and must preserve the original.
