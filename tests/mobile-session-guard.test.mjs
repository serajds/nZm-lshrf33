import test from "node:test";
import assert from "node:assert/strict";
import {
  responseBelongsToCurrentSession,
  shouldExpireSession,
} from "../artifacts/attendance-mobile/lib/session-guard.ts";

test("a renewed token only applies to the session that sent the request", () => {
  assert.equal(responseBelongsToCurrentSession("old-token", "old-token"), true);
  assert.equal(responseBelongsToCurrentSession("old-token", "new-login-token"), false);
  assert.equal(responseBelongsToCurrentSession(null, "active-token"), false);
});

test("a failed login cannot expire an existing session", () => {
  assert.equal(shouldExpireSession(401, null, "active-token"), false);
  assert.equal(shouldExpireSession(401, "stale-token", "active-token"), false);
  assert.equal(shouldExpireSession(401, "active-token", "active-token"), true);
  assert.equal(shouldExpireSession(403, "active-token", "active-token"), false);
});
