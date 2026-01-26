import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OrganizationProvider, SubscriptionProvider, ImpersonationProvider } from "@/contexts";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import Processes from "./pages/Processes";
import ProcessStatus from "./pages/ProcessStatus";
import ProcessStatusTest from "./pages/ProcessStatusTest";
import IcarusTest from "./pages/IcarusTest";
import CrawlerDiagnostics from "./pages/CrawlerDiagnostics";
import ApiDebugPage from "./pages/ApiDebugPage";
import Tasks from "./pages/Tasks";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";
import Utilities from "./pages/Utilities";
import Links from "./pages/Links";
import Filings from "./pages/Filings";
import CGPDetail from "./pages/CGPDetail";
import CGPRedirect from "./pages/CGPRedirect";
import WorkItemDetailPage from "./pages/WorkItemDetail/index";
import ItemRedirect from "./pages/ItemRedirect";
import Hearings from "./pages/Hearings";
import NotFound from "./pages/NotFound";
import DocumentSearch from "./pages/DocumentSearch";
import PeticionDetail from "./pages/PeticionDetail";
import AdminProcessDetail from "./pages/AdminProcessDetail";
import EmailInboxPage from "./pages/EmailInboxPage";
import NewProcess from "./pages/NewProcess";
import CpacaPage from "./pages/CpacaPage";
import { UnlinkedProcessesPage } from "./components/processes";
import InviteAccept from "./pages/InviteAccept";
import PlatformPage from "./pages/PlatformPage";
import { PublicLayout } from "./components/layout/PublicLayout";
import PublicPricingPage from "./pages/PublicPricingPage";
import MockCheckoutPage from "./pages/MockCheckoutPage";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setAuthenticated(!!session);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthenticated(!!session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;
  }

  return authenticated ? <>{children}</> : <Navigate to="/auth" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/invite/accept" element={<InviteAccept />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          
          {/* Public routes (no auth required) */}
          <Route element={<PublicLayout />}>
            <Route path="/pricing" element={<ErrorBoundary><PublicPricingPage /></ErrorBoundary>} />
          </Route>
          
          {/* Mock checkout route (auth required but no layout) */}
          <Route path="/billing/checkout/mock" element={<ProtectedRoute><ErrorBoundary><MockCheckoutPage /></ErrorBoundary></ProtectedRoute>} />
          
          {/* Protected routes with app layout */}
          <Route element={<ProtectedRoute><OrganizationProvider><SubscriptionProvider><ImpersonationProvider><AppLayout /></ImpersonationProvider></SubscriptionProvider></OrganizationProvider></ProtectedRoute>}>
            <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="/new-process" element={<ErrorBoundary><NewProcess /></ErrorBoundary>} />
            <Route path="/clients" element={<ErrorBoundary><Clients /></ErrorBoundary>} />
            <Route path="/clients/:id" element={<ErrorBoundary><ClientDetail /></ErrorBoundary>} />
            
            {/* Legacy /items route redirects to canonical work-items detail */}
            <Route path="/items/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            
            {/* Canonical Work Item Detail Route */}
            <Route path="/work-items/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            
            {/* CGP Unified Routes - redirect to canonical */}
            <Route path="/cgp/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            
            {/* Legacy route redirects - backward compatibility */}
            <Route path="/filings/:id" element={<ErrorBoundary><CGPRedirect type="filing" /></ErrorBoundary>} />
            <Route path="/processes/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="/process-status/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            
            {/* List views */}
            <Route path="/filings" element={<ErrorBoundary><Filings /></ErrorBoundary>} />
            <Route path="/processes" element={<ErrorBoundary><Processes /></ErrorBoundary>} />
            <Route path="/hearings" element={<ErrorBoundary><Hearings /></ErrorBoundary>} />
            <Route path="/process-status" element={<ErrorBoundary><ProcessStatus /></ErrorBoundary>} />
            <Route path="/process-status/link-clients" element={<ErrorBoundary><UnlinkedProcessesPage /></ErrorBoundary>} />
            <Route path="/process-status/test" element={<ErrorBoundary><ProcessStatusTest /></ErrorBoundary>} />
            <Route path="/process-status/test-icarus" element={<ErrorBoundary><IcarusTest /></ErrorBoundary>} />
            <Route path="/process-status/diagnostics/:runId" element={<ErrorBoundary><CrawlerDiagnostics /></ErrorBoundary>} />
            <Route path="/api-debug" element={<ErrorBoundary><ApiDebugPage /></ErrorBoundary>} />
            <Route path="/tasks" element={<ErrorBoundary><Tasks /></ErrorBoundary>} />
            <Route path="/alerts" element={<ErrorBoundary><Alerts /></ErrorBoundary>} />
            <Route path="/utilities" element={<ErrorBoundary><Utilities /></ErrorBoundary>} />
            <Route path="/links" element={<ErrorBoundary><Links /></ErrorBoundary>} />
            <Route path="/documents" element={<ErrorBoundary><DocumentSearch /></ErrorBoundary>} />
            {/* Legacy routes - redirect to canonical work-items detail */}
            <Route path="/peticiones/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="/admin-processes/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="/email-inbox" element={<ErrorBoundary><EmailInboxPage /></ErrorBoundary>} />
            <Route path="/cpaca" element={<ErrorBoundary><CpacaPage /></ErrorBoundary>} />
            <Route path="/billing" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="/settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="/platform" element={<ErrorBoundary><PlatformPage /></ErrorBoundary>} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
