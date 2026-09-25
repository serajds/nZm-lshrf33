import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeAuditDetails } from "../artifacts/api-server/src/lib/audit-sanitize.ts";

test("audit details retain allowlisted progress and permission data only", () => {
  const sanitized = sanitizeAuditDetails({
    actualProgressBefore: 45,
    actualProgressAfter: 75,
    statusAfter: "in_progress",
    groupIdsBefore: [2, 4],
    groupIdsAfter: [4],
    tabPermissionsBefore: { activities: "view", unknown: "edit" },
    tabPermissionsAfter: { activities: "edit" },
    password: "never-log-this",
    token: "secret-token",
    linkCode: "private-code",
    workDescription: "sensitive report text",
  });

  assert.deepEqual(sanitized, {
    actualProgressBefore: 45,
    actualProgressAfter: 75,
    statusAfter: "in_progress",
    groupIdsBefore: [2, 4],
    groupIdsAfter: [4],
    tabPermissionsBefore: { activities: "view" },
    tabPermissionsAfter: { activities: "edit" },
  });
  assert.doesNotMatch(JSON.stringify(sanitized), /never-log-this|secret-token|private-code|sensitive report text/);
});

test("audit details reject malformed or oversized values", () => {
  assert.equal(sanitizeAuditDetails({ password: "secret", details: { token: "secret" } }), null);
  assert.equal(sanitizeAuditDetails({ groupIdsAfter: [1, "2"] }), null);
  assert.equal(sanitizeAuditDetails({ actualProgress: Number.NaN }), null);
});

test("bulk activity audit metadata keeps counts and operation but not user-controlled labels", () => {
  assert.deepEqual(sanitizeAuditDetails({
    created: 12,
    updated: 9,
    operation: "reorder",
    groupName: "token=must-not-be-stored",
    rawName: "password=must-not-be-stored",
  }), {
    created: 12,
    updated: 9,
    operation: "reorder",
  });
});

test("group audit preserves bounded operation metadata, never the source code", () => {
  assert.deepEqual(sanitizeAuditDetails({
    operation: "link_project",
    previousSourceProjectId: null,
    sourceProjectId: 12,
    created: 1,
    updated: 0,
    unavailable: 0,
    linkCodeConfigured: true,
    sourceSnapshotsPreserved: true,
    updatedFields: ["name", "linkCode"],
    linkCode: "private-project-code",
  }), {
    operation: "link_project",
    previousSourceProjectId: null,
    sourceProjectId: 12,
    created: 1,
    updated: 0,
    unavailable: 0,
    linkCodeConfigured: true,
    sourceSnapshotsPreserved: true,
    updatedFields: ["name", "linkCode"],
  });
  assert.equal(sanitizeAuditDetails({ operation: "private-project-code" }), null);
});