import type { CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

const allNavItems = [
  { label: "ملخص المشروع", path: "", roles: null },
  { label: "الجدول الزمني", path: "/activities", roles: null },
  { label: "التمديدات", path: "/extensions", roles: ["admin", "project_manager", "engineer"] },
  { label: "التوقفات", path: "/suspensions", roles: ["admin", "project_manager", "engineer"] },
  { label: "التقارير", path: "/reports", roles: ["admin", "project_manager", "engineer"] },
  { label: "النماذج", path: "/forms", roles: null },
  { label: "الملفات", path: "/files", roles: ["admin", "project_manager", "engineer"] },
  { label: "تحليل الانحراف", path: "/deviation", roles: ["admin", "project_manager", "engineer"] },
];

interface ProjectNavProps {
  projectId: number;
}

export function ProjectNav({ projectId }: ProjectNavProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const basePath = `/projects/${projectId}`;
  const userRole = user?.role;

  const isContractorCompanyUser = user?.isContractorCompanyUser === true;
  const navItems = allNavItems.filter(item => {
    if (!item.roles) return true;
    if (isContractorCompanyUser) return false;
    return userRole && item.roles.includes(userRole);
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
