import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { getDefaultProjectId } from "@/lib/user-prefs";

// Eager imports — these are needed for the very first authenticated paint.
// Lazy-loading Dashboard/Projects/ProjectDetails was tried but caused
// "Failed to fetch dynamically imported module" errors whenever the
// dev server reloaded or a deployment changed chunk hashes — users
// saw an Arabic toast "تعذر تحميل جزء من البيانات بسبب قطع الاتصال".
// Keep these eager; the other heavier route pages stay lazy below.
import Login from "@/pages/login";
import PendingAssignment from "@/pages/pending-assignment";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects/index";
import ProjectDetails from "@/pages/projects/[id]";
const ProjectActivities = lazy(() => import("@/pages/projects/[id]/activities"));
const ProjectReports = lazy(() => import("@/pages/projects/[id]/reports"));
const ProjectFiles = lazy(() => import("@/pages/projects/[id]/files"));
const ProjectDeviation = lazy(() => import("@/pages/projects/[id]/deviation"));
const ProjectExtensions = lazy(() => import("@/pages/projects/[id]/extensions"));
const ProjectSuspensions = lazy(() => import("@/pages/projects/[id]/suspensions"));
const ProjectForms = lazy(() => import("@/pages/projects/[id]/forms"));
const ProjectAttendance = lazy(() => import("@/pages/projects/[id]/attendance"));
const Users = lazy(() => import("@/pages/users"));
const Companies = lazy(() => import("@/pages/companies"));
const AuditLog = lazy(() => import("@/pages/audit-log"));
const OwnerPortal = lazy(() => import("@/pages/owner/[token]"));
const PublicForm = lazy(() => import("@/pages/public-form"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache server data for 2 min before considering it stale. Aggressive
      // re-fetches on every focus/mount felt like "the app is slow" because
      // every tab switch triggered fresh API roundtrips for already-displayed
      // data. We still revalidate on mount when data IS stale.
      staleTime: 1000 * 60 * 2,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// PageFallback used to be a centered "جاري التحميل..." text that REPLACED
// the previous page on every navigation, which made the whole app feel
// "stuck loading everywhere". A lazy chunk usually resolves in <100ms once
// it's cached, so a thin top progress bar conveys activity without ripping
// the chrome off the screen.
function PageFallback() {
  return (
    <div className="fixed top-0 right-0 left-0 z-[60] h-0.5 overflow-hidden pointer-events-none">
      <div
        className="h-full bg-primary"
        style={{
          width: "40%",
          animation: "page-loading-bar 1.1s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes page-loading-bar {
          0% { transform: translateX(120%); }
          100% { transform: translateX(-220%); }
        }
      `}</style>
    </div>
  );
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      جاري التحميل...
    </div>
  );
}

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
  return (
    <AppLayout>
      <Suspense fallback={<PageFallback />}>
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
      </Suspense>
    </AppLayout>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/login" component={Login} />
        <Route path="/owner/:token" component={OwnerPortal} />
        <Route path="/form/:token" component={PublicForm} />
        <Route>
          {isLoading ? (
            <FullScreenLoader />
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
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
