import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { InstallButton } from "@/components/install-button";
import { InstallPromptBanner } from "@/components/install-prompt-banner";
import { NotificationToggle } from "@/components/notification-toggle";
import { AppFooter } from "@/components/app-footer";
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  ChevronLeft,
  Menu,
  X,
  Landmark,
  ClipboardList,
} from "lucide-react";

const SIDEBAR_FULL = 256;
const SIDEBAR_COLLAPSED = 64;

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  const isAdmin = user?.role === "admin";
  const isAdminOrPM = isAdmin || user?.role === "project_manager";
  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;

  const navigation = [
    ...(!isContractor
      ? [{ name: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard }]
      : []),
    { name: "المشاريع", href: isContractor ? "/" : "/projects", icon: Building2 },
    ...(!isContractor && isAdminOrPM
      ? [{ name: "الشركات", href: "/companies", icon: Landmark }]
      : []),
    ...(!isContractor && isAdmin
      ? [
          { name: "المستخدمون", href: "/users", icon: Users },
          { name: "سجل العمليات", href: "/audit-log", icon: ClipboardList },
        ]
      : []),
  ];

  const currentPage = navigation.find(
    (n) =>
      location === n.href ||
      (n.href !== "/" && location.startsWith(n.href))
  );

  const initials = user?.fullName
    ? user.fullName
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
    : "م";

  const sidebarWidth = desktopCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_FULL;

  const NavItem = ({ item, collapsed }: { item: typeof navigation[0]; collapsed: boolean }) => {
    const isActive =
      location === item.href ||
      (item.href !== "/" && location.startsWith(item.href));

    return (
      <Link href={item.href}>
        <span
          className={cn(
            "flex items-center rounded-lg cursor-pointer transition-all duration-300 relative overflow-hidden group",
            isActive ? "shadow-md shadow-primary/20" : ""
          )}
          style={{
            gap: collapsed ? 0 : 10,
            padding: collapsed ? "10px 0" : "9px 12px",
            justifyContent: collapsed ? "center" : "flex-start",
            color: isActive
              ? "hsl(var(--sidebar-accent-foreground))"
              : "hsl(var(--sidebar-foreground))",
            opacity: isActive ? 1 : 0.7,
          }}
          onMouseEnter={(e) => {
            if (!isActive) {
              (e.currentTarget as HTMLElement).style.backgroundColor = "hsl(var(--sidebar-accent) / 0.3)";
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive) {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLElement).style.opacity = "0.7";
            }
          }}
        >
          {/* Active navigation state */}
          {isActive && (
            <div className="absolute inset-0 bg-primary/15 -z-10" />
          )}
          {isActive && (
            <span
              className="absolute right-0 top-1/2 rounded-full"
              style={{
                width: 3,
                height: 18,
                backgroundColor: "hsl(var(--sidebar-primary))",
                transform: "translateY(-50%)",
              }}
            />
          )}
          <item.icon
            className="shrink-0"
            style={{
              width: 17,
              height: 17,
              color: isActive ? "hsl(var(--sidebar-primary))" : "inherit",
            }}
          />
          {!collapsed && (
            <span className="text-sm font-medium truncate">{item.name}</span>
          )}
        </span>
      </Link>
    );
  };

  const SidebarContent = ({ collapsed, onClose }: { collapsed: boolean; onClose?: () => void }) => (
    <>
      {/* Header */}
      <div
        className="flex items-center h-16 shrink-0 overflow-hidden"
        style={{
          padding: collapsed ? "0 12px" : "0 16px",
          borderBottom: "1px solid hsl(var(--sidebar-border))",
        }}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary-foreground shrink-0 shadow-sm ring-1 ring-white/10">
          <Building2 className="h-5 w-5 text-primary" strokeWidth={2} />
        </div>

        {!collapsed && (
          <div className="flex-1 min-w-0 mr-3">
            <p
              className="text-sm font-bold leading-tight truncate"
              style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
            >
              إدارة الإشراف والمتابعة
            </p>
          </div>
        )}

        {onClose ? (
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 transition-colors mr-auto"
            style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.5 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => setDesktopCollapsed(!desktopCollapsed)}
            className="shrink-0 rounded-md p-1 transition-colors"
            style={{
              color: "hsl(var(--sidebar-foreground))",
              opacity: 0.5,
              marginRight: collapsed ? "auto" : undefined,
              marginLeft: collapsed ? "auto" : undefined,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
            title={collapsed ? "توسيع القائمة" : "طي القائمة"}
          >
            <ChevronLeft
              className="w-4 h-4 transition-transform duration-250"
              style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)" }}
            />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-1">
        {navigation.map((item) => (
          <NavItem key={item.href} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div
        className="shrink-0 overflow-hidden"
        style={{
          borderTop: "1px solid hsl(var(--sidebar-border))",
          padding: collapsed ? "12px 8px" : "12px 14px",
        }}
      >
        {collapsed ? (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center rounded-lg p-2 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
            style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.7 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.7";
              e.currentTarget.style.color = "hsl(var(--sidebar-foreground))";
            }}
            title="تسجيل الخروج"
          >
            <LogOut className="w-5 h-5" />
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-full shrink-0 text-sm font-bold shadow-sm"
              style={{
                width: 38,
                height: 38,
                backgroundColor: "hsl(var(--sidebar-accent))",
                color: "hsl(var(--sidebar-accent-foreground))",
              }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-bold truncate"
                style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
              >
                {user?.fullName}
              </p>
              <p
                className="text-xs font-medium truncate mt-0.5"
                style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.6 }}
              >
                {user?.role === "admin" ? "مدير النظام" : user?.role === "project_manager" ? "مدير مشروع" : user?.role === "contractor" ? "مقاول" : "مهندس مشرف"}
              </p>
            </div>
            <button
              onClick={logout}
              className="shrink-0 rounded-lg p-2 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
              style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.6 }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#ef4444";
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "hsl(var(--sidebar-foreground))";
                e.currentTarget.style.opacity = "0.6";
              }}
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-[100dvh] w-full bg-[hsl(var(--sidebar))] text-slate-100 overflow-hidden" dir="rtl">

      {/* ===== DESKTOP SIDEBAR ===== */}
      <aside
        className="hidden h-full shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-slate-950/20 md:flex md:py-2 md:pr-2"
        style={{
          width: sidebarWidth,
          backgroundColor: "hsl(var(--sidebar))",
          transition: "width 250ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <SidebarContent collapsed={desktopCollapsed} />
      </aside>

      {/* ===== MOBILE SIDEBAR OVERLAY ===== */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden backdrop-blur-sm"
          style={{ backgroundColor: "rgba(2,6,23,0.8)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ===== MOBILE SIDEBAR DRAWER ===== */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex flex-col md:hidden shadow-2xl"
        style={{
          width: SIDEBAR_FULL,
          backgroundColor: "#020617",
          borderLeft: "1px solid rgba(255,255,255,0.05)",
          transform: mobileOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 280ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <SidebarContent collapsed={false} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* ===== MAIN CONTENT CARD ===== */}
      <div className="flex-1 flex flex-col h-[100dvh] md:py-2 md:pl-2 min-w-0 transition-all duration-300">
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground shadow-none md:rounded-r-2xl md:border md:border-border/70 md:shadow-[-8px_0_24px_rgba(15,23,42,0.08)] dark:md:border-border">
          {/* ---- Top Header ── */}
          <header
            className="z-10 flex h-[4.5rem] shrink-0 items-center gap-3 border-b border-border/60 bg-background px-4 transition-colors duration-200 md:px-7"
          >
            {/* Hamburger — mobile only */}
            <button
              className="md:hidden flex items-center justify-center rounded-md p-1.5 transition-colors"
              style={{ color: "hsl(var(--foreground))", opacity: 0.7 }}
              onClick={() => setMobileOpen(true)}
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div
              className="h-5 w-0.5 rounded-full hidden md:block"
              style={{ backgroundColor: "hsl(var(--primary))", opacity: 0.7 }}
            />
            <h1 className="font-semibold text-base text-foreground truncate tracking-wide">
              {currentPage?.name || "إدارة الإشراف والمتابعة"}
            </h1>
            <div className="mr-auto flex items-center gap-2">
              <span className="hidden lg:inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
                <span className="status-dot bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
                النظام يعمل بشكل طبيعي
              </span>
              <NotificationToggle />
              <InstallButton />
            </div>
          </header>

          {/* ---- Page Content ---- */}
          <div className="z-0 flex min-h-0 flex-1 flex-col overflow-auto bg-background p-3 sm:p-5 lg:p-7">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-w-0 flex-1 pb-10">{children}</div>
              <AppFooter />
            </div>
          </div>
        </main>
      </div>

      {/* Auto-shown PWA install suggestion (snoozes for 7 days on dismiss) */}
      <InstallPromptBanner />
    </div>
  );
}
