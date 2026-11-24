# Phase three — report-image browser queue, partial

This phase adds local report-image preparation and a bounded queue for the
private Reports upload route. The controlled browser load below validates the
client encoder/queue mechanics; it is not a live end-to-end multi-user load.
Public share images were later moved to the shared lifecycle in phase six.
Phone-device behavior, PWA/offline transport and non-raster image formats remain
unverified or transitional.

## Implemented

- Selected JPG/JPEG, PNG, WebP, HEIC/HEIF, TIFF and AVIF candidates up to the
  shared 20 MiB source limit. SVG is rejected. Browser decoding is attempted
  in a dedicated worker; unsupported browser decoders fall back to the bounded
  server decoder. Unsupported/corrupt formats and pixel limits fail explicitly.
- Browser preprocessing applies image orientation, strips metadata by drawing
  pixels to a clean canvas, never enlarges, and limits the report long edge to
  the shared 1600-pixel policy. WebP is preferred; JPEG is a fallback when
  WebP encoding is unavailable or exceeds the shared output cap. Quality is
  bounded rather than repeatedly reducing engineering detail to force a size.
- A project report editor shares two queue slots across image groups. Each
  selected file has an independent stable idempotency key, visible queued,
  preparing, sending, retrying, failed or cancelled state, byte progress,
  timeout, cancellation, bounded exponential retry, and retry-only-failed
  controls. Every send reads the current session token and processes token
  renewal/401 responses against that request's token.
- Completed files are inserted in selection order, not network-completion
  order. Upload completions for a removed group are not inserted into the
  report. Unresolved failures must be retried or explicitly removed before
  saving the report. The server's existing authenticated report permissions
  and transactional image/file identity remain in force.
- The editor requests 400-pixel thumbnails for managed images and falls back
  to the original protected URL if a legacy or damaged asset lacks that
  thumbnail. It does not request a pageful of full-resolution originals.

## Measurements and tests

`generated-artifacts/image-audit/client-preparation-baseline.json` contains
the sanitized raw browser result. In headless Chromium, a synthetic dense-grid
JPEG (3200×2400, 2,204,832 bytes) prepared to WebP (1600×1200, 197,724 bytes)
in 360.7 ms in the recorded run. The recorded main-thread long-task maximum
during worker preparation was 0 ms. Base64 decoded exactly to the output
byte count. A second controlled browser run verified two concurrent uploads
maximum, five ordered queue completions, same-key recovery after a lost
response, and cancellation. Worker cancellation rejected as `AbortError`. The
mock transport is not an API/storage result.

The separate API integration tests use real HTTP/JWT, the explicit development
bucket and a private PostgreSQL fixture; see `phase-02.md`. Phase eight later
records a 50-image mixed HTTP run using the bounded client queue. No real
handset, 5–20 MiB phone photograph, browser memory/GPU measurement, intermittent
real network or published-edge workload was accepted.

## Still required for phase three

- Test partial failure, expired session, delayed/lost success response,
  concurrent retries, network disconnect, 1/10/20-image runs, 5–20 MiB inputs,
  supported/unsupported HEIC and the existing share cap under actual requests.
- Record before/after browser/server/transport/storage/database measurements
  and quality comparisons using the same fixtures.
- Do not infer mobile browser, PWA, production edge or phone-camera support
  from desktop Chromium or the local server.
