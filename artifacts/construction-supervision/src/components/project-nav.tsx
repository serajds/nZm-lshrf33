import type { CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";

type TabKey =
  | "overview"
  | "activities"
  | "extensions"
  | "suspensions"
  | "reports"
  | "forms"
  | "attendance"
  | "files"
  | "deviation";

const allNavItems: { label: string; path: string; tab: TabKey; legacyRoles?: string[] | null }[] = [
  { label: "ملخص المشروع", path: "", tab: "overview", legacyRoles: null },
  { label: "الجدول الزمني", path: "/activities", tab: "activities", legacyRoles: null },
  { label: "التمديدات", path: "/extensions", tab: "extensions", legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "التوقفات", path: "/suspensions", tab: "suspensions", legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "التقارير", path: "/reports", tab: "reports", legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "النماذج", path: "/forms", tab: "forms", legacyRoles: null },
  { label: "الحضور", path: "/attendance", tab: "attendance", legacyRoles: ["admin", "project_manager", "engineer", "owner"] },
  { label: "الملفات", path: "/files", tab: "files", legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "تحليل الانحراف", path: "/deviation", tab: "deviation", legacyRoles: ["admin", "project_manager", "engineer"] },
];

interface ProjectNavProps {
  projectId: number;
}

export function ProjectNav({ projectId }: ProjectNavProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const basePath = `/projects/${projectId}`;
  const userRole = user?.role;

  const { data: myPermissions } = useMyProjectPermissions(projectId);

  const isContractorCompanyUser = user?.isContractorCompanyUser === true;
  const tabPermissions = myPermissions?.tabPermissions as Record<TabKey, "hidden" | "view" | "edit"> | undefined;

  const navItems = allNavItems.filter(item => {
    // Prefer the new tab-permission system whenever the API has supplied one.
    if (tabPermissions && tabPermissions[item.tab]) {
      return tabPermissions[item.tab] !== "hidden";
    }
    // Backwards-compatible fallback to the legacy role-based filter.
    if (!item.legacyRoles) return true;
    if (isContractorCompanyUser) return false;
    return userRole && item.legacyRoles.includes(userRole);
  });

  return (
    <div
      className="overflow-x-auto -mx-4 md:-mx-6"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as CSSProperties}
    >
      <div
        className="flex border-b border-border px-4 md:px-6"
        style={{ minWidth: "max-content" }}
      >
        {navItems.map((item) => {
          const href = `${basePath}${item.path}`;
          const isActive =
            item.path === ""
              ? location === href
              : location.startsWith(href);

          return (
            <Link key={item.path} href={href}>
              <span
                className={`inline-flex items-center px-3 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm font-medium whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                style={{ marginBottom: "-1px" }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
