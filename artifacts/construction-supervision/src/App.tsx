import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { RouteErrorBoundary } from "@/components/error-boundary";
import { getDefaultProjectId } from "@/lib/user-prefs";

// Eager: tiny + always-needed (login is the very first paint for unauth'd users).
import Login from "@/pages/login";
import PendingAssignment from "@/pages/pending-assignment";
import NotFound from "@/pages/not-found";

// AppLayout pulls in the sidebar, install banner, notification toggle, and
// a chunk of lucide icons — none of which the unauth'd login page needs.
// Lazy-loading it knocks ~30 KB (gzipped) off the initial bundle.
const AppLayout = lazy(() =>
  import("@/components/layout").then((m) => ({ default: m.AppLayout })),
);

// Lazy: every other page is only loaded when its route is hit. Splits the
// initial JS bundle into ~15 small per-route chunks instead of one huge file
// containing recharts, leaflet, xlsx, framer-motion, and 20+ pages.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Projects = lazy(() => import("@/pages/projects/index"));
const ProjectDetails = lazy(() => import("@/pages/projects/[id]"));
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

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      جاري التحميل...
    </div>
  );
}

function ProtectedRoute({ component: Component, allowedRoles }: { component: React.ComponentType; allowedRoles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">جاري التحميل...</div>;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

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

  return (
    <AppLayout>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </AppLayout>
  );
}

function HomeRoute() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">جاري التحميل...</div>;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

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

  const Component = isContractor ? Projects : Dashboard;

  return (
    <AppLayout>
      <Suspense fallback={<PageFallback />}>
        <Component />
      </Suspense>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/owner/:token" component={OwnerPortal} />
      <Route path="/form/:token" component={PublicForm} />
      
      <Route path="/">
        <HomeRoute />
      </Route>
      <Route path="/projects">
        <ProtectedRoute component={Projects} />
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute component={Dashboard} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/activities">
        <ProtectedRoute component={ProjectActivities} />
      </Route>
      <Route path="/projects/:id/reports">
        <ProtectedRoute component={ProjectReports} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/files">
        <ProtectedRoute component={ProjectFiles} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/deviation">
        <ProtectedRoute component={ProjectDeviation} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/extensions">
        <ProtectedRoute component={ProjectExtensions} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/suspensions">
        <ProtectedRoute component={ProjectSuspensions} allowedRoles={["admin", "project_manager", "engineer"]} />
      </Route>
      <Route path="/projects/:id/forms">
        <ProtectedRoute component={ProjectForms} />
      </Route>
      <Route path="/projects/:id/attendance">
        <ProtectedRoute component={ProjectAttendance} allowedRoles={["admin", "project_manager", "engineer", "owner"]} />
      </Route>
      <Route path="/projects/:id">
        <ProtectedRoute component={ProjectDetails} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={Users} allowedRoles={["admin"]} />
      </Route>
      <Route path="/companies">
        <ProtectedRoute component={Companies} allowedRoles={["admin", "project_manager"]} />
      </Route>
      <Route path="/audit-log">
        <ProtectedRoute component={AuditLog} allowedRoles={["admin"]} />
      </Route>
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <RouteErrorBoundary>
              <Router />
            </RouteErrorBoundary>
          </AuthProvider>
        </WouterRouter>
        <Toaster position="top-center" dir="rtl" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
