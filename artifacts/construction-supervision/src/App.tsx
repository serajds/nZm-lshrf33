import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects/index";
import ProjectDetails from "@/pages/projects/[id]";
import ProjectActivities from "@/pages/projects/[id]/activities";
import ProjectReports from "@/pages/projects/[id]/reports";
import ProjectFiles from "@/pages/projects/[id]/files";
import ProjectDeviation from "@/pages/projects/[id]/deviation";
import ProjectExtensions from "@/pages/projects/[id]/extensions";
import ProjectSuspensions from "@/pages/projects/[id]/suspensions";
import ProjectForms from "@/pages/projects/[id]/forms";
import Users from "@/pages/users";
import Companies from "@/pages/companies";
import AuditLog from "@/pages/audit-log";
import OwnerPortal from "@/pages/owner/[token]";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function ProtectedRoute({ component: Component, allowedRoles }: { component: React.ComponentType; allowedRoles?: string[] }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">جاري التحميل...</div>;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
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
      <Component />
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

  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;
  const Component = isContractor ? Projects : Dashboard;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/owner/:token" component={OwnerPortal} />
      
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
      <Route path="/projects/:id">
        <ProtectedRoute component={ProjectDetails} allowedRoles={["admin", "project_manager", "engineer"]} />
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
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster position="top-center" dir="rtl" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
