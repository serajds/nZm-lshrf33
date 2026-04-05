import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { 
  LayoutDashboard, 
  Building2, 
  Users, 
  LogOut,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  const navigation = [
    { name: "لوحة التحكم", href: "/", icon: LayoutDashboard },
    { name: "المشاريع", href: "/projects", icon: Building2 },
    ...(user?.role === "admin" ? [{ name: "المستخدمون", href: "/users", icon: Users }] : []),
  ];

  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-screen w-full bg-background" dir="rtl">
        <Sidebar className="border-l border-border" side="right">
          <SidebarHeader className="p-4 border-b border-border">
            <h2 className="text-lg font-bold text-primary truncate">الإشراف الهندسي</h2>
            <p className="text-xs text-muted-foreground truncate">{user?.fullName}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user?.role === 'admin' ? 'مدير النظام' : 'مهندس مشرف'}</p>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>القائمة الرئيسية</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigation.map((item) => {
                    const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.name}>
                          <Link href={item.href} className="flex items-center gap-2">
                            <item.icon className="h-4 w-4" />
                            <span>{item.name}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="p-4 border-t border-border">
            <Button variant="ghost" className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={logout}>
              <LogOut className="h-4 w-4" />
              <span>تسجيل الخروج</span>
            </Button>
          </SidebarFooter>
        </Sidebar>
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 border-b border-border bg-card flex items-center px-4 lg:px-6 sticky top-0 z-10 shrink-0 gap-4">
            <SidebarTrigger />
            <div className="font-semibold text-lg">
              {navigation.find(n => location === n.href || (n.href !== "/" && location.startsWith(n.href)))?.name || "نظام الإشراف الهندسي"}
            </div>
          </header>
          <div className="flex-1 overflow-auto p-4 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
