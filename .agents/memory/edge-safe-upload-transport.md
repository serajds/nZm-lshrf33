---
name: Edge-safe upload transport
description: Why binary/file uploads must go over base64 text/plain JSON, not multipart, to survive Replit's Autoscale edge.
---

# Edge-safe upload transport

Base64/text/plain remains the proven compatibility default for web/mobile;
do not adopt untested `multipart/form-data`. Replit's Autoscale edge runs a CSRF check that requires
Origin/Referer on POSTs and can reject requests where those headers are
stripped — returning the edge's own HTML error page (e.g. "403 Forbidden")
that never reaches Express. The classic trigger is the web app's PWA / Workbox
service worker replaying an offline-queued upload: the replay reaches the edge
without Origin/Referer and gets blocked intermittently.

**Rule:** retain the working JSON body with `Content-Type: text/plain`, encoding
the binary as base64 (e.g. `selfieBase64`). `text/plain` is a CORS-safe content
type the edge always lets through. The api-server already parses text/plain
bodies as JSON (a global middleware in `app.ts`), so handlers see `req.body`
exactly like a browser JSON request. This is the same transport the rest of the
mobile JSON calls already use.

**Why:** this is the transport previously proven to survive the edge for POSTs from
header-stripped contexts. Multipart and `application/json` both depend on the
edge CSRF heuristics that fail intermittently.

**How to apply:**
- Server: accept both shapes — branch on `Content-Type`; for non-multipart,
  decode the base64 field, validate it's a real image via `sharp().metadata()`,
  write it to the uploads dir, and synthesize a minimal `req.file`
  (`{ path, filename, mimetype }`) so the downstream handler is unchanged.
- Body parser limit: base64 inflates payloads ~33%. The `express.text`
  (text/plain) limit must exceed the base64 size of the max raw upload, or valid
  files get rejected by the parser *before* the route's own size checks. Keep the
  text/plain limit and the route's raw-size cap in lockstep (e.g. 15MB raw ≈
  20MB base64 → set text/plain limit to 22mb).
- Client error handling: never echo a non-JSON response body back to the user —
  it may be a raw edge/proxy HTML page. Only surface a JSON `{ error }`; otherwise
  show a generic Arabic message. App is RTL Arabic — preserve Arabic copy.
- Keep genuine JSON 403s (geofence/role/profile) intact; the edge fix is only
  about transport, not the app's own authorization rejections.

The user now requires a fair empirical comparison with binary and direct
object-storage upload. This compatibility history is not permission to retain
Base64 solely because it is old, nor permission to switch solely because a
loopback microbenchmark favors binary.

**Why:** The approved image overhaul explicitly reopens transport selection
while requiring edge, authorization, integrity, CORS and PWA compatibility.

**How to apply:** Measure identical images and workloads; keep the working
transport until an alternative passes those checks without exposing edge HTML
to users.
