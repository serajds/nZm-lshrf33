import { lazy, startTransition, Suspense, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { getDefaultProjectId } from "@/lib/user-prefs";
import { loadRouteModule } from "@/lib/route-module-recovery";
import { AutomaticNoticeProvider } from "@/components/automatic-notices";
import { retryRead } from "@/lib/query-policy";
import { ConnectionStatus } from "@/components/connection-status";

import Login from "@/pages/login";
import PendingAssignment from "@/pages/pending-assignment";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";

// Route chunks are allowed to fail once after a deployment rotates hashed asset
// names. A single guarded reload refreshes the entry manifest without creating
// an infinite reload loop, while normal navigation remains fully lazy-loaded.
function lazyRoute<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>, key: string) {
  const RetryPage = () => (
    <section dir="rtl" role="alert" className="m-6 rounded-xl border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold">تعذّر تحميل الصفحة</h1>
      <p className="my-3 text-muted-foreground">تحقق من الاتصال ثم أعد تحميل الصفحة. لم تتغير بياناتك.</p>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        onClick={() => {
          try { sessionStorage.removeItem(`route-chunk-retry:${key}`); } catch { /* Storage may be blocked. */ }
          window.location.reload();
        }}>إعادة تحميل الصفحة</button>
    </section>
  );
  return lazy(() => loadRouteModule<{ default: ComponentType<any> }>(loader, key, {
    storage: {
      getItem: k => sessionStorage.getItem(k),
      setItem: (k, v) => sessionStorage.setItem(k, v),
      removeItem: k => sessionStorage.removeItem(k),
    },
    reload: () => window.location.reload(),
    fallback: () => ({ default: RetryPage }),
  }));
}

const Dashboard = lazyRoute(() => import("@/pages/dashboard"), "dashboard");
const Projects = lazyRoute(() => import("@/pages/projects/index"), "projects");
const ProjectDetails = lazyRoute(() => import("@/pages/projects/[id]"), "project-details");
const ProjectActivities = lazyRoute(() => import("@/pages/projects/[id]/activities"), "activities");
const ProjectReports = lazyRoute(() => import("@/pages/projects/[id]/reports"), "reports");
const ProjectFiles = lazyRoute(() => import("@/pages/projects/[id]/files"), "files");
const ProjectDeviation = lazyRoute(() => import("@/pages/projects/[id]/deviation"), "deviation");
const ProjectExtensions = lazyRoute(() => import("@/pages/projects/[id]/extensions"), "extensions");
const ProjectSuspensions = lazyRoute(() => import("@/pages/projects/[id]/suspensions"), "suspensions");
const ProjectForms = lazyRoute(() => import("@/pages/projects/[id]/forms"), "forms");
const ProjectAttendance = lazyRoute(() => import("@/pages/projects/[id]/attendance"), "attendance");
const Users = lazyRoute(() => import("@/pages/users"), "users");
const Companies = lazyRoute(() => import("@/pages/companies"), "companies");
const AuditLog = lazyRoute(() => import("@/pages/audit-log"), "audit-log");
const OwnerPortal = lazyRoute(() => import("@/pages/owner/[token]"), "owner-portal");
const PublicForm = lazyRoute(() => import("@/pages/public-form"), "public-form");
const PublicReportImageUpload = lazyRoute(() => import("@/pages/public-report-image-upload"), "public-report-image-upload");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Trust cached data for 5 minutes before considering it stale, and
      // keep it in memory for 30 minutes after the last component that
      // uses it unmounts. This is the single biggest perceived-speed win
      // because every project sub-tab (reports, activities, files, …)
      // re-uses the same /api/projects/:id, /members, /permissions and
      // /activities responses; with 5-minute caching, jumping between
      // tabs becomes instant once you've visited each one.
      //
      // Heavy/expensive queries (dashboard summary, project summary,
      // project list, …) override these defaults locally where useful
      // (placeholderData to avoid blanking on key-changes etc.).
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      retry: retryRead,
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

import { FullScreenLoader, PageFallback, AuthConnectionProblem } from "@/components/loaders";
import { PageTransition } from "@/components/page-transition";

// PageFallback and FullScreenLoader have been moved to @/components/loaders

// Pure access-control wrapper. It only decides whether to render the page
// or redirect — it no longer wraps the page in AppLayout. AppLayout is now
// mounted ONCE above the route Switch (see AuthenticatedShell), so navigating
// between pages no longer unmounts/remounts the sidebar and header on every
// click.
function RequireRole({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user } = useAuth();

  if (user?.incompleteProfile) {
    return <Redirect to="/" />;
  }

  if (allowedRoles && user?.role && !allowedRoles.includes(user.role)) {
    return <Redirect to="/" />;
  }

  const isContractorCompanyUser = user?.isContractorCompanyUser === true;
  if (isContractorCompanyUser && allowedRoles && !allowedRoles.includes("contractor")) {
    return <Redirect to="/" />;
  }

  return <>{children}</>;
}

function HomeRoute() {
  const { user } = useAuth();

  if (user?.incompleteProfile) {
    return <PendingAssignment />;
  }

  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;

  if (!isContractor) {
    const defaultProjectId = getDefaultProjectId(user?.id);
    if (defaultProjectId) {
      return <Redirect to={`/projects/${defaultProjectId}`} />;
    }
  }

  return isContractor ? <Projects /> : <Dashboard />;
}

// Mounted ONCE for any authenticated route. AppLayout (sidebar + header)
// stays put; only the inner page swaps. The single Suspense boundary uses
// the slim top progress bar so navigating between lazy pages doesn't blank
// out the screen.
function AuthenticatedShell() {
  const { user, connectionError, retryAuth, isRetryingAuth } = useAuth();
  return (
    <AutomaticNoticeProvider key={user?.id}>
    <AppLayout>
      <ConnectionStatus />
      {connectionError && (
        <div role="alert" dir="rtl" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted p-3 text-sm">
          <span>تعذّر تحديث بيانات الجلسة. لم يتم تسجيل خروجك.</span>
          <button type="button" className="font-semibold text-primary underline disabled:opacity-50"
            disabled={isRetryingAuth} onClick={retryAuth}>
            {isRetryingAuth ? "جارٍ التحقق..." : "إعادة المحاولة"}
          </button>
        </div>
      )}
      <Suspense fallback={<PageFallback />}>
        <PageTransition>
          <Switch>
              <Route path="/">
                <HomeRoute />
              </Route>
              <Route path="/projects">
                <Projects />
              </Route>
              <Route path="/dashboard">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <Dashboard />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/activities">
                <ProjectActivities />
              </Route>
              <Route path="/projects/:id/reports">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <ProjectReports />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/files">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <ProjectFiles />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/deviation">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <ProjectDeviation />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/extensions">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <ProjectExtensions />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/suspensions">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer"]}>
                  <ProjectSuspensions />
                </RequireRole>
              </Route>
              <Route path="/projects/:id/forms">
                <ProjectForms />
              </Route>
              <Route path="/projects/:id/attendance">
                <RequireRole allowedRoles={["admin", "project_manager", "engineer", "owner"]}>
                  <ProjectAttendance />
                </RequireRole>
              </Route>
              <Route path="/projects/:id">
                <ProjectDetails />
              </Route>
              <Route path="/users">
                <RequireRole allowedRoles={["admin"]}>
                  <Users />
                </RequireRole>
              </Route>
              <Route path="/companies">
                <RequireRole allowedRoles={["admin", "project_manager"]}>
                  <Companies />
                </RequireRole>
              </Route>
              <Route path="/audit-log">
                <RequireRole allowedRoles={["admin"]}>
                  <AuditLog />
                </RequireRole>
              </Route>
              <Route component={NotFound} />
          </Switch>
        </PageTransition>
      </Suspense>
    </AppLayout>
    </AutomaticNoticeProvider>
  );
}

function Router() {
  const { isAuthenticated, isLoading, connectionError, retryAuth, isRetryingAuth, logout } = useAuth();

  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/owner/:token" component={OwnerPortal} />
        <Route path="/form/:token" component={PublicForm} />
        <Route path="/report-image-upload" component={PublicReportImageUpload} />
        <Route>
          {isLoading ? (
            <FullScreenLoader />
          ) : connectionError && !isAuthenticated ? (
            <AuthConnectionProblem onRetry={retryAuth} onLogout={() => { void logout(); }} isRetrying={isRetryingAuth} />
          ) : !isAuthenticated ? (
            <Redirect to="/login" />
          ) : (
            <AuthenticatedShell />
          )}
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={import.meta.env.BASE_URL.replace(/\/$/, "")}
          aroundNav={(navigate, to, options) => {
            startTransition(() => navigate(to, options));
          }}
        >
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster position="top-center" dir="rtl" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
