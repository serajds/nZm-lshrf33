import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
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
import Users from "@/pages/users";
import OwnerPortal from "@/pages/owner/[token]";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center">جاري التحميل...</div>;
  }

  if (!isAuthenticated) {
    window.location.href = "/login";
    return null;
  }

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
        <ProtectedRoute component={Dashboard} />
      </Route>
      <Route path="/projects">
        <ProtectedRoute component={Projects} />
      </Route>
      <Route path="/projects/:id/activities">
        <ProtectedRoute component={ProjectActivities} />
      </Route>
      <Route path="/projects/:id/reports">
        <ProtectedRoute component={ProjectReports} />
      </Route>
      <Route path="/projects/:id/files">
        <ProtectedRoute component={ProjectFiles} />
      </Route>
      <Route path="/projects/:id/deviation">
        <ProtectedRoute component={ProjectDeviation} />
      </Route>
      <Route path="/projects/:id/extensions">
        <ProtectedRoute component={ProjectExtensions} />
      </Route>
      <Route path="/projects/:id">
        <ProtectedRoute component={ProjectDetails} />
      </Route>
      <Route path="/users">
        <ProtectedRoute component={Users} />
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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
