---
name: API readiness path
description: Keep multi-artifact API readiness checks aligned with the route production actually probes.
---

Use the API service's production-observed mount path for readiness when deployment logs show that path is being checked, and keep the explicit health endpoint available as well.

**Why:** Production telemetry showed failed checks against `/api` while `/api/healthz` succeeded; the mount root returned 404 even though artifact configuration named the explicit endpoint.

**How to apply:** Compare the logged probe path with the public routed API path, verify both routes safely, and do not infer the active service port from a separate Dockerfile.
