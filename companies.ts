import type { TabAccess, TabPermissionsMap } from "@workspace/db";

export const TAB_KEYS = [
  "overview",
  "activities",
  "extensions",
  "suspensions",
  "reports",
  "forms",
  "attendance",
  "files",
  "deviation",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

export const TAB_LABELS_AR: Record<TabKey, string> = {
  overview: "ملخص المشروع",
  activities: "الجدول الزمني",
  extensions: "التمديدات",
  suspensions: "التوقفات",
  reports: "التقارير",
  forms: "النماذج",
  attendance: "الحضور",
  files: "الملفات",
  deviation: "تحليل الانحراف",
};

type ProjectRoleForDefaults = "admin" | "project_manager" | "engineer" | "contractor" | "viewer" | "owner";

/**
 * Default per-tab access for a user based on their effective project role.
 * These mirror the historical role-based behavior so existing projects
 * keep working without any explicit overrides.
 */
export function defaultPermissionsForRole(projectRole: ProjectRoleForDefaults): Record<TabKey, TabAccess> {
  if (projectRole === "admin" || projectRole === "project_manager") {
    return {
      overview: "edit",
      activities: "edit",
      extensions: "edit",
      suspensions: "edit",
      reports: "edit",
      forms: "edit",
      attendance: "edit",
      files: "edit",
      deviation: "edit",
    };
  }

  if (projectRole === "engineer") {
    // الافتراضي للأعضاء الجدد: كل التبويبات مشاهدة فقط.
    // يستطيع مدير المشروع/الأدمن رفع الصلاحية لكل تبويب على حدة من نافذة الصلاحيات.
    return {
      overview: "view",
      activities: "view",
      extensions: "view",
      suspensions: "view",
      reports: "view",
      forms: "view",
      attendance: "view",
      files: "view",
      deviation: "view",
    };
  }

  if (projectRole === "viewer") {
    return {
      overview: "view",
      activities: "view",
      extensions: "view",
      suspensions: "view",
      reports: "view",
      forms: "view",
      attendance: "view",
      files: "view",
      deviation: "view",
    };
  }

  if (projectRole === "owner") {
    return {
      overview: "view",
      activities: "view",
      extensions: "hidden",
      suspensions: "hidden",
      reports: "hidden",
      forms: "view",
      attendance: "view",
      files: "hidden",
      deviation: "hidden",
    };
  }

  // contractor: project members table contractor / contractor company users
  return {
    overview: "view",
    activities: "view",
    extensions: "hidden",
    suspensions: "hidden",
    reports: "hidden",
    forms: "view",
    attendance: "hidden",
    files: "hidden",
    deviation: "hidden",
  };
}

/**
 * Merge defaults with explicit overrides stored on project_members.tab_permissions.
 * Overrides only apply to known TAB_KEYS; unknown keys are ignored.
 *
 * Contractors are intentionally excluded from the override system — their
 * permissions are locked to the historical defaults (overview/activities/forms
 * = view, everything else hidden). This protects the well-known contractor
 * behavior from being accidentally widened or narrowed by a project manager
 * editing the per-tab permissions UI. Any stored overrides on contractor
 * memberships are ignored at read time; no DB cleanup is required.
 */
export function resolveTabPermissions(
  projectRole: ProjectRoleForDefaults,
  overrides: TabPermissionsMap | null | undefined,
): Record<TabKey, TabAccess> {
  const base = defaultPermissionsForRole(projectRole);
  if (projectRole === "contractor") return base;
  if (!overrides) return base;
  const out: Record<TabKey, TabAccess> = { ...base };
  for (const key of TAB_KEYS) {
    const v = overrides[key];
    if (v === "hidden" || v === "view" || v === "edit") {
      out[key] = v;
    }
  }
  return out;
}

export function isValidTabPermissions(input: unknown): input is TabPermissionsMap {
  if (!input || typeof input !== "object") return false;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(TAB_KEYS as readonly string[]).includes(k)) return false;
    if (v !== "hidden" && v !== "view" && v !== "edit") return false;
  }
  return true;
}
