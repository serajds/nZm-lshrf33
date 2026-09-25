const numberFields = new Set([
  "actualProgress",
  "plannedProgress",
  "weight",
  "progressPercentage",
  "groupId",
  "externalSourceGroupId",
  "actualProgressBefore",
  "actualProgressAfter",
  "plannedProgressBefore",
  "plannedProgressAfter",
  "externalSourceGroupIdBefore",
  "externalSourceGroupIdAfter",
  "previousSourceProjectId",
  "sourceProjectId",
  "created",
  "updated",
  "unavailable",
  "groupCount",
]);
const dateFields = new Set([
  "actualStartDate",
  "actualEndDate",
  "plannedStartDate",
  "plannedEndDate",
  "reportDate",
]);
const statusFields = new Set(["status", "statusBefore", "statusAfter"]);
const roleFields = new Set(["roleBefore", "roleAfter"]);
const activityStatuses = new Set(["not_started", "in_progress", "completed", "delayed"]);
const reportStatuses = new Set(["draft", "approved"]);
const projectRoles = new Set(["project_manager", "engineer", "contractor", "viewer"]);

const groupIdFields = new Set(["groupIdsBefore", "groupIdsAfter"]);
const tabPermissionFields = new Set(["tabPermissionsBefore", "tabPermissionsAfter"]);
const groupOperations = new Set([
  "reorder",
  "update",
  "link_project",
  "unlink_project",
  "sync",
]);
const groupUpdatedFields = new Set(["name", "color", "linkCode"]);
const changedFieldNames = new Set([
  "name",
  "actualProgress",
  "plannedProgress",
  "weight",
  "actualStartDate",
  "actualEndDate",
  "plannedStartDate",
  "plannedEndDate",
  "status",
  "groupId",
  "externalSourceGroupId",
  "type",
  "reportDate",
  "periodStart",
  "periodEnd",
  "workDescription",
  "technicalNotes",
  "recommendations",
  "imageGroups",
  "imageUrls",
  "activitiesSnapshot",
  "progressPercentage",
  "tabPermissions",
]);
const tabKeys = new Set([
  "overview",
  "activities",
  "extensions",
  "suspensions",
  "reports",
  "forms",
  "attendance",
  "files",
  "deviation",
]);

/**
 * Keep audit details intentionally small and typed. Never serialize request
 * bodies wholesale: arbitrary values can contain passwords, bearer tokens,
 * link codes, or personal data.
 */
export function sanitizeAuditDetails(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "operation" && typeof value === "string" && groupOperations.has(value)) {
      result[key] = value;
      continue;
    }
    if ((key === "linkCodeConfigured" || key === "sourceSnapshotsPreserved") && typeof value === "boolean") {
      result[key] = value;
      continue;
    }
    if (key === "updatedFields" && Array.isArray(value) && value.length <= 3
      && value.every(field => typeof field === "string" && groupUpdatedFields.has(field))) {
      result[key] = [...new Set(value)];
      continue;
    }
    if (numberFields.has(key)) {
      if (value === null || typeof value === "number" && Number.isFinite(value)
        && (key.includes("Progress") || key === "progressPercentage" ? value >= 0 && value <= 100 : value >= 0)) {
        result[key] = value;
      }
      continue;
    }

    if (dateFields.has(key) && (value === null || typeof value === "string"
      && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value))) {
      result[key] = value;
      continue;
    }

    if (statusFields.has(key) && typeof value === "string"
      && (activityStatuses.has(value) || reportStatuses.has(value))) {
      result[key] = value;
      continue;
    }

    if (roleFields.has(key) && typeof value === "string" && projectRoles.has(value)) {
      result[key] = value;
      continue;
    }

    if (groupIdFields.has(key) && Array.isArray(value) && value.length <= 500
      && value.every(id => Number.isInteger(id) && id > 0)) {
      result[key] = [...value];
      continue;
    }

    if (key === "changedFields" && Array.isArray(value) && value.length <= 30
      && value.every(field => typeof field === "string" && changedFieldNames.has(field))) {
      result[key] = [...new Set(value)];
      continue;
    }

    if (tabPermissionFields.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
      const permissions: Record<string, "view" | "edit"> = {};
      for (const [tab, access] of Object.entries(value)) {
        if (tabKeys.has(tab) && (access === "view" || access === "edit")) {
          permissions[tab] = access;
        }
      }
      result[key] = permissions;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}