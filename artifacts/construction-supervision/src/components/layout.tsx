import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
  const isContractor = user?.role === "contractor" || (user as Record<string, unknown>)?.isContractorCompanyUser === true;

  const navigation = [
    ...(!isContractor
      ? [{ name: "لوحة التحكم", href: "/", icon: LayoutDashboard }]
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
          className="flex items-center rounded-lg cursor-pointer transition-colors"
          style={{
            gap: collapsed ? 0 : 10,
            padding: collapsed ? "10px 0" : "9px 12px",
            justifyContent: collapsed ? "center" : "flex-start",
            backgroundColor: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
            color: isActive
              ? "hsl(var(--sidebar-accent-foreground))"
              : "hsl(var(--sidebar-foreground))",
            opacity: isActive ? 1 : 0.65,
            position: "relative",
          }}
          onMouseEnter={(e) => {
            if (!isActive) {
              (e.currentTarget as HTMLElement).style.backgroundColor = "hsl(var(--sidebar-accent) / 0.5)";
              (e.currentTarget as HTMLElement).style.opacity = "1";
            }
          }}
          onMouseLeave={(e) => {
            if (!isActive) {
              (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLElement).style.opacity = "0.65";
            }
          }}
        >
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
        <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="Logo" className="w-9 h-9 rounded-lg shrink-0" />

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
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 space-y-0.5">
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
            className="w-full flex items-center justify-center rounded-lg p-2 transition-colors"
            style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.5 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = "1";
              e.currentTarget.style.color = "#f87171";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = "0.5";
              e.currentTarget.style.color = "hsl(var(--sidebar-foreground))";
            }}
            title="تسجيل الخروج"
          >
            <LogOut className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center rounded-full shrink-0 text-xs font-bold"
              style={{
                width: 34,
                height: 34,
                backgroundColor: "hsl(var(--sidebar-accent))",
                color: "hsl(var(--sidebar-accent-foreground))",
              }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-xs font-semibold truncate"
                style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
              >
                {user?.fullName}
              </p>
              <p
                className="text-[11px] truncate"
                style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.5 }}
              >
                {user?.role === "admin" ? "مدير النظام" : user?.role === "project_manager" ? "مدير مشروع" : user?.role === "contractor" ? "مقاول" : "مهندس مشرف"}
              </p>
            </div>
            <button
              onClick={logout}
              className="shrink-0 rounded-md p-1.5 transition-colors"
              style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.45 }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#f87171";
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "hsl(var(--sidebar-foreground))";
                e.currentTarget.style.opacity = "0.45";
              }}
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-background" dir="rtl">

      {/* ===== DESKTOP SIDEBAR ===== */}
      <aside
        className="hidden md:flex fixed inset-y-0 right-0 z-50 flex-col"
        style={{
          width: sidebarWidth,
          backgroundColor: "hsl(var(--sidebar))",
          borderLeft: "1px solid hsl(var(--sidebar-border))",
          transition: "width 250ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <SidebarContent collapsed={desktopCollapsed} />
      </aside>

      {/* ===== MOBILE SIDEBAR OVERLAY ===== */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ===== MOBILE SIDEBAR DRAWER ===== */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex flex-col md:hidden"
        style={{
          width: SIDEBAR_FULL,
          backgroundColor: "hsl(var(--sidebar))",
          borderLeft: "1px solid hsl(var(--sidebar-border))",
          transform: mobileOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 280ms cubic-bezier(.4,0,.2,1)",
        }}
      >
        <SidebarContent collapsed={false} onClose={() => setMobileOpen(false)} />
      </aside>

      {/* ===== MAIN CONTENT ===== */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{
          marginRight: undefined,
        }}
      >
        {/* Hidden spacer on desktop to push content away from sidebar */}
        <style>{`
          @media (min-width: 768px) {
            .main-content-wrapper {
              margin-right: ${sidebarWidth}px;
              transition: margin-right 250ms cubic-bezier(.4,0,.2,1);
            }
          }
        `}</style>
        <div className="flex-1 flex flex-col min-w-0 main-content-wrapper">
          {/* ---- Top Header ---- */}
          <header
            className="sticky top-0 z-40 h-14 flex items-center px-4 md:px-6 gap-3 shrink-0"
            style={{
              backgroundColor: "hsl(var(--card))",
              borderBottom: "1px solid hsl(var(--border))",
            }}
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
            <h1 className="font-semibold text-base text-foreground truncate">
              {currentPage?.name || "إدارة الإشراف والمتابعة"}
            </h1>
          </header>

          {/* ---- Page Content ---- */}
          <main className="flex-1 overflow-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
