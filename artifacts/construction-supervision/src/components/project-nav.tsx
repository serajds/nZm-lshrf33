import type { CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { CalendarRange, ClipboardList, Clock3, FileText, FolderOpen, LayoutDashboard, PauseCircle, TrendingDown, UserCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";
import { ProjectActivityReminder } from "./project-activity-reminder";

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

const allNavItems: { label: string; path: string; tab: TabKey; icon: LucideIcon; legacyRoles?: string[] | null }[] = [
  { label: "ملخص المشروع", path: "", tab: "overview", icon: LayoutDashboard, legacyRoles: null },
  { label: "الجدول الزمني", path: "/activities", tab: "activities", icon: CalendarRange, legacyRoles: null },
  { label: "التمديدات", path: "/extensions", tab: "extensions", icon: Clock3, legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "التوقفات", path: "/suspensions", tab: "suspensions", icon: PauseCircle, legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "التقارير", path: "/reports", tab: "reports", icon: FileText, legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "النماذج", path: "/forms", tab: "forms", icon: ClipboardList, legacyRoles: null },
  { label: "الحضور", path: "/attendance", tab: "attendance", icon: UserCheck, legacyRoles: ["admin", "project_manager", "engineer", "owner"] },
  { label: "الملفات", path: "/files", tab: "files", icon: FolderOpen, legacyRoles: ["admin", "project_manager", "engineer"] },
  { label: "تحليل الانحراف", path: "/deviation", tab: "deviation", icon: TrendingDown, legacyRoles: ["admin", "project_manager", "engineer"] },
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
    <>
    <ProjectActivityReminder projectId={projectId} canViewActivities={navItems.some(item => item.tab === "activities")} />
    <div
      className="-mx-1 overflow-x-auto rounded-2xl border border-border/70 bg-card/80 p-1.5 shadow-sm md:mx-0"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as CSSProperties}
    >
      <div
        className="flex gap-1"
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
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer transition-all sm:px-4 sm:text-sm ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
                style={{ marginBottom: "-1px" }}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
    </>
  );
}
