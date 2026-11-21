import { useLayoutEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { CalendarRange, ClipboardList, Clock3, FileText, FolderOpen, LayoutDashboard, PauseCircle, TrendingDown, UserCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";
import { captureProjectTabScrollPosition, restoreProjectTabScrollPosition } from "@/lib/project-tab-scroll";
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

interface PendingProjectTabScroll {
  projectId: number;
  from: string;
  to: string;
  capturedAt: number;
  position: ReturnType<typeof captureProjectTabScrollPosition>;
}

let pendingProjectTabScroll: PendingProjectTabScroll | null = null;

export function ProjectNav({ projectId }: ProjectNavProps) {
  const [location] = useLocation();
  const navScrollRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    const pending = pendingProjectTabScroll;
    if (!pending) return;

    if (Date.now() - pending.capturedAt > 30_000) {
      pendingProjectTabScroll = null;
      return;
    }

    if (pending.projectId !== projectId || pending.to !== location) {
      if (pending.from !== location) pendingProjectTabScroll = null;
      return;
    }

    const scrollContainer = document.querySelector<HTMLElement>("[data-project-page-scroll]");
    const navContainer = navScrollRef.current;
    if (!scrollContainer || !navContainer) return;

    const restoreStartedAt = Date.now();
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const contentContainer = scrollContainer.children[0]?.children[0];
    const finish = (clearPending = true) => {
      if (finished) return;
      finished = true;
      if (clearPending && pendingProjectTabScroll === pending) pendingProjectTabScroll = null;
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (timeout) clearTimeout(timeout);
      if (frame !== undefined) cancelAnimationFrame(frame);
      scrollContainer.removeEventListener("wheel", cancelRestore);
      scrollContainer.removeEventListener("touchstart", cancelRestore);
      scrollContainer.removeEventListener("pointerdown", cancelRestore);
    };
    const attemptRestore = () => {
      frame = undefined;
      if (finished || pendingProjectTabScroll !== pending) {
        finish();
        return;
      }

      const restored = restoreProjectTabScrollPosition(scrollContainer, navContainer, pending.position);
      if (restored || Date.now() - restoreStartedAt >= 5_000) finish();
    };
    const scheduleRestore = () => {
      if (!finished && frame === undefined) frame = requestAnimationFrame(attemptRestore);
    };
    const cancelRestore = () => {
      if (pendingProjectTabScroll === pending) pendingProjectTabScroll = null;
      finish();
    };
    const resizeObserver = new ResizeObserver(scheduleRestore);
    const mutationObserver = new MutationObserver(scheduleRestore);
    resizeObserver.observe(scrollContainer);
    if (contentContainer instanceof HTMLElement) resizeObserver.observe(contentContainer);
    mutationObserver.observe(scrollContainer, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    scrollContainer.addEventListener("wheel", cancelRestore, { passive: true });
    scrollContainer.addEventListener("touchstart", cancelRestore, { passive: true });
    scrollContainer.addEventListener("pointerdown", cancelRestore, { passive: true });
    timeout = setTimeout(finish, 5_000);
    scheduleRestore();

    return () => {
      // The source tab unmounts during route navigation. Keep the saved
      // position for the destination tab, which will attach its own observers.
      finish(false);
    };
  }, [location, projectId]);

  const rememberScrollPosition = (targetPath: string) => {
    if (targetPath === location) return;

    const scrollContainer = document.querySelector<HTMLElement>("[data-project-page-scroll]");
    const navContainer = navScrollRef.current;
    if (!scrollContainer || !navContainer) return;

    pendingProjectTabScroll = {
      projectId,
      from: location,
      to: targetPath,
      capturedAt: Date.now(),
      position: captureProjectTabScrollPosition(scrollContainer, navContainer),
    };
  };

  return (
    <>
    <ProjectActivityReminder projectId={projectId} canViewActivities={navItems.some(item => item.tab === "activities")} />
    <nav
      aria-label="أقسام المشروع"
      className="rounded-2xl border border-border/70 bg-card p-1.5 shadow-sm md:p-2"
    >
      <div
        ref={navScrollRef}
        className="flex gap-1.5 overflow-x-auto"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        {navItems.map((item) => {
          const href = `${basePath}${item.path}`;
          const isActive =
            item.path === ""
              ? location === href
              : location.startsWith(href);

          return (
            <Link
              key={item.path}
              href={href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => rememberScrollPosition(href)}
              className={`relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-4 sm:text-sm ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
            >
              <item.icon aria-hidden="true" className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
              <span>{item.label}</span>
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-4 bottom-1 h-0.5 rounded-full bg-primary-foreground/65"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
    </>
  );
}
