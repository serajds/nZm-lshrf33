---
name: Current-role authorization
description: Privileged requests must reflect role changes immediately despite valid JWTs.
---

Authorize protected requests with the user's current database role, not the role embedded in an otherwise valid session token. Rolling-session renewal must also sign the current role. A removed user must not continue using a still-valid token.

**Why:** A demoted administrator's existing token previously retained access to unrelated projects and their private link codes, and could renew itself with the old admin claim.

**How to apply:** For any new privileged endpoint or authorization shortcut, use the role resolved by authenticated middleware. Do not decode the token independently and trust its role, or issue renewed tokens from old claims.