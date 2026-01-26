import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OrganizationProvider, SubscriptionProvider, ImpersonationProvider } from "@/contexts";
import { TenantRouteGuard, PlatformRouteGuard } from "@/components/auth";
import { TenantLayout } from "@/components/layout/TenantLayout";
import { PlatformLayout } from "@/components/layout/PlatformLayout";
import { PublicLayout } from "@/components/layout/PublicLayout";

// Pages
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
import CGPRedirect from "./pages/CGPRedirect";
import WorkItemDetailPage from "./pages/WorkItemDetail/index";
import ItemRedirect from "./pages/ItemRedirect";
import Hearings from "./pages/Hearings";
import NotFound from "./pages/NotFound";
import DocumentSearch from "./pages/DocumentSearch";
import EmailInboxPage from "./pages/EmailInboxPage";
import NewProcess from "./pages/NewProcess";
import CpacaPage from "./pages/CpacaPage";
import { UnlinkedProcessesPage } from "./components/processes";
import InviteAccept from "./pages/InviteAccept";
import PublicPricingPage from "./pages/PublicPricingPage";
import MockCheckoutPage from "./pages/MockCheckoutPage";
import JoinPage from "./pages/JoinPage";
import VoucherRedeemPage from "./pages/VoucherRedeemPage";

// Platform Console Pages
import {
  PlatformVerificationPage,
  PlatformMetricsPage,
  PlatformOrganizationsPage,
  PlatformSubscriptionsPage,
  PlatformVouchersPage,
  PlatformLimitsPage,
  PlatformSupportPage,
  PlatformUsersPage,
  PlatformAuditPage,
  PlatformEmailOpsPage,
  PlatformSystemPage,
} from "./pages/platform";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* Auth route */}
          <Route path="/auth" element={<Auth />} />
          <Route path="/invite/accept" element={<InviteAccept />} />
          
          {/* Root redirects to tenant app */}
          <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
          
          {/* Legacy routes redirect to new /app/* paths */}
          <Route path="/dashboard" element={<Navigate to="/app/dashboard" replace />} />
          <Route path="/clients" element={<Navigate to="/app/clients" replace />} />
          <Route path="/clients/:id" element={<Navigate to="/app/clients/:id" replace />} />
          <Route path="/processes" element={<Navigate to="/app/processes" replace />} />
          <Route path="/hearings" element={<Navigate to="/app/hearings" replace />} />
          <Route path="/tasks" element={<Navigate to="/app/tasks" replace />} />
          <Route path="/alerts" element={<Navigate to="/app/alerts" replace />} />
          <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
          <Route path="/utilities" element={<Navigate to="/app/utilities" replace />} />
          <Route path="/links" element={<Navigate to="/app/links" replace />} />
          
          {/* Public routes (no auth required) */}
          <Route element={<PublicLayout />}>
            <Route path="/pricing" element={<ErrorBoundary><PublicPricingPage /></ErrorBoundary>} />
            <Route path="/join" element={<ErrorBoundary><JoinPage /></ErrorBoundary>} />
            <Route path="/v/redeem/:token" element={<ErrorBoundary><VoucherRedeemPage /></ErrorBoundary>} />
          </Route>
          
          {/* Mock checkout route (auth required but no layout) */}
          <Route path="/billing/checkout/mock" element={
            <TenantRouteGuard>
              <ErrorBoundary><MockCheckoutPage /></ErrorBoundary>
            </TenantRouteGuard>
          } />
          
          {/* ============================================ */}
          {/* TENANT ROUTES - /app/* */}
          {/* ============================================ */}
          <Route path="/app" element={
            <TenantRouteGuard>
              <OrganizationProvider>
                <SubscriptionProvider>
                  <ImpersonationProvider>
                    <TenantLayout />
                  </ImpersonationProvider>
                </SubscriptionProvider>
              </OrganizationProvider>
            </TenantRouteGuard>
          }>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="new-process" element={<ErrorBoundary><NewProcess /></ErrorBoundary>} />
            <Route path="clients" element={<ErrorBoundary><Clients /></ErrorBoundary>} />
            <Route path="clients/:id" element={<ErrorBoundary><ClientDetail /></ErrorBoundary>} />
            
            {/* Work Item routes */}
            <Route path="items/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="work-items/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="cgp/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="filings/:id" element={<ErrorBoundary><CGPRedirect type="filing" /></ErrorBoundary>} />
            <Route path="processes/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="process-status/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            
            {/* List views */}
            <Route path="filings" element={<ErrorBoundary><Filings /></ErrorBoundary>} />
            <Route path="processes" element={<ErrorBoundary><Processes /></ErrorBoundary>} />
            <Route path="hearings" element={<ErrorBoundary><Hearings /></ErrorBoundary>} />
            <Route path="process-status" element={<ErrorBoundary><ProcessStatus /></ErrorBoundary>} />
            <Route path="process-status/link-clients" element={<ErrorBoundary><UnlinkedProcessesPage /></ErrorBoundary>} />
            <Route path="process-status/test" element={<ErrorBoundary><ProcessStatusTest /></ErrorBoundary>} />
            <Route path="process-status/test-icarus" element={<ErrorBoundary><IcarusTest /></ErrorBoundary>} />
            <Route path="process-status/diagnostics/:runId" element={<ErrorBoundary><CrawlerDiagnostics /></ErrorBoundary>} />
            <Route path="api-debug" element={<ErrorBoundary><ApiDebugPage /></ErrorBoundary>} />
            <Route path="tasks" element={<ErrorBoundary><Tasks /></ErrorBoundary>} />
            <Route path="alerts" element={<ErrorBoundary><Alerts /></ErrorBoundary>} />
            <Route path="utilities" element={<ErrorBoundary><Utilities /></ErrorBoundary>} />
            <Route path="links" element={<ErrorBoundary><Links /></ErrorBoundary>} />
            <Route path="documents" element={<ErrorBoundary><DocumentSearch /></ErrorBoundary>} />
            <Route path="peticiones/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="admin-processes/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="email-inbox" element={<ErrorBoundary><EmailInboxPage /></ErrorBoundary>} />
            <Route path="cpaca" element={<ErrorBoundary><CpacaPage /></ErrorBoundary>} />
            <Route path="billing" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
          </Route>
          
          {/* ============================================ */}
          {/* PLATFORM ROUTES - /platform/* */}
          {/* Each route maps directly to a page component */}
          {/* ============================================ */}
          <Route path="/platform" element={
            <PlatformRouteGuard>
              <ImpersonationProvider>
                <PlatformLayout />
              </ImpersonationProvider>
            </PlatformRouteGuard>
          }>
            {/* Default route redirects to verification */}
            <Route index element={<Navigate to="/platform/verification" replace />} />
            <Route path="verification" element={<ErrorBoundary><PlatformVerificationPage /></ErrorBoundary>} />
            <Route path="metrics" element={<ErrorBoundary><PlatformMetricsPage /></ErrorBoundary>} />
            <Route path="organizations" element={<ErrorBoundary><PlatformOrganizationsPage /></ErrorBoundary>} />
            <Route path="subscriptions" element={<ErrorBoundary><PlatformSubscriptionsPage /></ErrorBoundary>} />
            <Route path="vouchers" element={<ErrorBoundary><PlatformVouchersPage /></ErrorBoundary>} />
            <Route path="limits" element={<ErrorBoundary><PlatformLimitsPage /></ErrorBoundary>} />
            <Route path="support" element={<ErrorBoundary><PlatformSupportPage /></ErrorBoundary>} />
            <Route path="users" element={<ErrorBoundary><PlatformUsersPage /></ErrorBoundary>} />
            <Route path="audit" element={<ErrorBoundary><PlatformAuditPage /></ErrorBoundary>} />
            <Route path="email-ops" element={<ErrorBoundary><PlatformEmailOpsPage /></ErrorBoundary>} />
            <Route path="system" element={<ErrorBoundary><PlatformSystemPage /></ErrorBoundary>} />
          </Route>
          
          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
