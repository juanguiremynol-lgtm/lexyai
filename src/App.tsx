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
import PublicLandingPage from "./pages/PublicLandingPage";
import OnboardingProfile from "./pages/OnboardingProfile";
import VerifyAlertEmail from "./pages/VerifyAlertEmail";
import VerifyEmail from "./pages/VerifyEmail";
import SuperAdminAccess from "./pages/SuperAdminAccess";
import LegalTermsPage from "./pages/LegalTermsPage";
import { TermsReAcceptanceGuard } from "./components/legal/TermsReAcceptanceGuard";
import PlatformAuthProvidersPage from "./pages/platform/PlatformAuthProvidersPage";
import { LaunchGatedAuth } from "@/components/launch/LaunchGatedAuth";
import { LaunchGatedDemo } from "@/components/launch/LaunchGatedDemo";
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
import WorkItemDetailPage from "./pages/WorkItemDetail/index";
import ItemRedirect from "./pages/ItemRedirect";
import Hearings from "./pages/Hearings";
import NotFound from "./pages/NotFound";
import DocumentSearch from "./pages/DocumentSearch";
import EmailInboxPage from "./pages/EmailInboxPage";
import EmailPage from "./pages/EmailPage";
import NewProcess from "./pages/NewProcess";
import CpacaPage from "./pages/CpacaPage";
import { UnlinkedProcessesPage } from "./components/processes";
import InviteAccept from "./pages/InviteAccept";
import PublicPricingPage from "./pages/PublicPricingPage";
import CheckoutSuccess from "./pages/CheckoutSuccess";
import MockCheckoutPage from "./pages/MockCheckoutPage";
import JoinPage from "./pages/JoinPage";
import VoucherRedeemPage from "./pages/VoucherRedeemPage";
import DemoPage from "./pages/DemoPage";
import EstadosHoy from "./pages/EstadosHoy";
import ActuacionesHoy from "./pages/ActuacionesHoy";
import SigningPage from "./pages/SigningPage";
import VerifyDocumentPage from "./pages/VerifyDocumentPage";
import WorkItemDocumentWizard from "./pages/WorkItemDocumentWizard";
import DocumentDetailPage from "./pages/DocumentDetailPage";
import DocumentsDashboard from "./pages/DocumentsDashboard";
import SistemaSalud from "./pages/SistemaSalud";

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
  PlatformAteniaAIPage,
  PlatformCourthouseDirectoryPage,
  PlatformExternalProvidersPage,
  PlatformBillingPage,
  PlatformNotificationsPage,
  PlatformGeminiPage,
  PlatformSecurityPage,
  PlatformEmailProviderPage,
  PlatformAnalyticsPage,
  PlatformDemoAnalyticsPage,
  PlatformDailyOpsReportsPage,
  PlatformJudicialSuspensionsPage,
  PlatformEmailConsolePage,
  PlatformEmailSetupPage,
  PlatformAdminAlertsPage,
  PlatformCoverageGapsPage,
  PlatformWaitlistPage,
  PlatformPdfSettingsPage,
  PlatformGenericSigningPage,
  PlatformGenericSigningDocsPage,
  PlatformHearingsCatalogPage,
  PlatformNotificationDispatchPage,
} from "./pages/platform";
import PlatformProviderWizardPage from "./pages/platform/PlatformProviderWizardPage";
import BillingTestConsole from "./pages/platform/BillingTestConsole";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: (failureCount, error: unknown) => {
        if (error instanceof Error && error.message === 'AUTH_TOKEN_EXPIRED') {
          return failureCount < 2;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => {
        return attemptIndex === 0 ? 2000 : Math.min(1000 * 2 ** attemptIndex, 10000);
      },
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* ============================================ */}
          {/* PUBLIC ROUTES - No auth required */}
          {/* ============================================ */}
          
          {/* Root landing page - public marketing page */}
          <Route path="/" element={<ErrorBoundary><PublicLandingPage /></ErrorBoundary>} />
          <Route path="/demo" element={<ErrorBoundary><LaunchGatedDemo /></ErrorBoundary>} />
          <Route path="/prueba" element={<ErrorBoundary><LaunchGatedDemo /></ErrorBoundary>} />
          
          {/* Auth routes — launch-gated for normal users */}
          <Route path="/auth" element={<LaunchGatedAuth />} />
          <Route path="/auth/login" element={<LaunchGatedAuth />} />
          <Route path="/auth/signup" element={<LaunchGatedAuth />} />
          
          {/* Super Admin access — NEVER launch-gated */}
          <Route path="/super-admin-access" element={<SuperAdminAccess />} />
          <Route path="/onboarding/profile" element={<OnboardingProfile />} />
          <Route path="/verify-alert-email" element={<VerifyAlertEmail />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/invite/accept" element={<InviteAccept />} />
          
          {/* Public routes with PublicLayout */}
          <Route element={<PublicLayout />}>
            <Route path="/pricing" element={<ErrorBoundary><PublicPricingPage /></ErrorBoundary>} />
            <Route path="/checkout" element={<ErrorBoundary><CheckoutSuccess /></ErrorBoundary>} />
            <Route path="/join" element={<ErrorBoundary><JoinPage /></ErrorBoundary>} />
            <Route path="/v/redeem/:token" element={<ErrorBoundary><VoucherRedeemPage /></ErrorBoundary>} />
            <Route path="/legal" element={<ErrorBoundary><LegalTermsPage /></ErrorBoundary>} />
            <Route path="/legal/terms" element={<ErrorBoundary><LegalTermsPage /></ErrorBoundary>} />
            <Route path="/legal/privacy" element={<ErrorBoundary><LegalTermsPage /></ErrorBoundary>} />
          </Route>
          
          {/* Public signing & verification pages — NO auth required */}
          <Route path="/sign/:token" element={<ErrorBoundary><SigningPage /></ErrorBoundary>} />
          <Route path="/verify/:documentId" element={<ErrorBoundary><VerifyDocumentPage /></ErrorBoundary>} />
          <Route path="/verify" element={<ErrorBoundary><VerifyDocumentPage /></ErrorBoundary>} />
          
          {/* Legacy root redirects to app (for authenticated users) */}
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
              <TermsReAcceptanceGuard>
                <OrganizationProvider>
                  <SubscriptionProvider>
                    <ImpersonationProvider>
                      <TenantLayout />
                    </ImpersonationProvider>
                  </SubscriptionProvider>
                </OrganizationProvider>
              </TermsReAcceptanceGuard>
            </TenantRouteGuard>
          }>
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="new-process" element={<ErrorBoundary><NewProcess /></ErrorBoundary>} />
            <Route path="clients" element={<ErrorBoundary><Clients /></ErrorBoundary>} />
            <Route path="clients/:id" element={<ErrorBoundary><ClientDetail /></ErrorBoundary>} />
            
            {/* Work Item routes - all point to unified detail page */}
            <Route path="items/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="work-items/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="cgp/:id" element={<ErrorBoundary><WorkItemDetailPage /></ErrorBoundary>} />
            <Route path="filings/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="processes/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            <Route path="process-status/:id" element={<ErrorBoundary><ItemRedirect /></ErrorBoundary>} />
            
            {/* List views - filings redirects to processes (unified view) */}
            <Route path="filings" element={<Navigate to="/app/processes" replace />} />
            <Route path="processes" element={<ErrorBoundary><Processes /></ErrorBoundary>} />
            <Route path="estados-hoy" element={<ErrorBoundary><EstadosHoy /></ErrorBoundary>} />
            <Route path="actuaciones-hoy" element={<ErrorBoundary><ActuacionesHoy /></ErrorBoundary>} />
            <Route path="hearings" element={<ErrorBoundary><Hearings /></ErrorBoundary>} />
            <Route path="process-status" element={<ErrorBoundary><ProcessStatus /></ErrorBoundary>} />
            <Route path="process-status/link-clients" element={<ErrorBoundary><UnlinkedProcessesPage /></ErrorBoundary>} />
            <Route path="process-status/test" element={<ErrorBoundary><ProcessStatusTest /></ErrorBoundary>} />
            <Route path="process-status/test-icarus" element={<PlatformRouteGuard><ErrorBoundary><IcarusTest /></ErrorBoundary></PlatformRouteGuard>} />
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
            <Route path="email" element={<ErrorBoundary><EmailPage /></ErrorBoundary>} />
            <Route path="cpaca" element={<ErrorBoundary><CpacaPage /></ErrorBoundary>} />
            <Route path="work-items/:id/documents/new" element={<ErrorBoundary><WorkItemDocumentWizard /></ErrorBoundary>} />
            <Route path="work-items/:id/documents/:docId" element={<ErrorBoundary><DocumentDetailPage /></ErrorBoundary>} />
            <Route path="documentos-legales" element={<ErrorBoundary><DocumentsDashboard /></ErrorBoundary>} />
            <Route path="sistema" element={<ErrorBoundary><SistemaSalud /></ErrorBoundary>} />
            <Route path="documents/:docId" element={<ErrorBoundary><DocumentDetailPage /></ErrorBoundary>} />
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
            <Route index element={<Navigate to="/platform/notifications" replace />} />
            <Route path="notifications" element={<ErrorBoundary><PlatformNotificationsPage /></ErrorBoundary>} />
            <Route path="verification" element={<ErrorBoundary><PlatformVerificationPage /></ErrorBoundary>} />
            <Route path="metrics" element={<ErrorBoundary><PlatformMetricsPage /></ErrorBoundary>} />
            <Route path="organizations" element={<ErrorBoundary><PlatformOrganizationsPage /></ErrorBoundary>} />
            <Route path="subscriptions" element={<ErrorBoundary><PlatformSubscriptionsPage /></ErrorBoundary>} />
            <Route path="billing" element={<ErrorBoundary><PlatformBillingPage /></ErrorBoundary>} />
            <Route path="vouchers" element={<ErrorBoundary><PlatformVouchersPage /></ErrorBoundary>} />
            <Route path="limits" element={<ErrorBoundary><PlatformLimitsPage /></ErrorBoundary>} />
            <Route path="support" element={<ErrorBoundary><PlatformSupportPage /></ErrorBoundary>} />
            <Route path="users" element={<ErrorBoundary><PlatformUsersPage /></ErrorBoundary>} />
            <Route path="audit" element={<ErrorBoundary><PlatformAuditPage /></ErrorBoundary>} />
            <Route path="email-ops" element={<ErrorBoundary><PlatformEmailOpsPage /></ErrorBoundary>} />
            <Route path="system" element={<ErrorBoundary><PlatformSystemPage /></ErrorBoundary>} />
            <Route path="api-debug" element={<Navigate to="/platform/atenia-ai" replace />} />
            <Route path="atenia-ai" element={<ErrorBoundary><PlatformAteniaAIPage /></ErrorBoundary>} />
            <Route path="gemini" element={<ErrorBoundary><PlatformGeminiPage /></ErrorBoundary>} />
            <Route path="security" element={<ErrorBoundary><PlatformSecurityPage /></ErrorBoundary>} />
            <Route path="courthouse-directory" element={<ErrorBoundary><PlatformCourthouseDirectoryPage /></ErrorBoundary>} />
            <Route path="external-providers" element={<ErrorBoundary><PlatformExternalProvidersPage /></ErrorBoundary>} />
            <Route path="external-providers/wizard" element={<ErrorBoundary><PlatformProviderWizardPage /></ErrorBoundary>} />
            <Route path="email-console" element={<ErrorBoundary><PlatformEmailConsolePage /></ErrorBoundary>} />
            <Route path="email-provider" element={<ErrorBoundary><PlatformEmailProviderPage /></ErrorBoundary>} />
            <Route path="email-setup" element={<ErrorBoundary><PlatformEmailSetupPage /></ErrorBoundary>} />
            <Route path="analytics" element={<ErrorBoundary><PlatformAnalyticsPage /></ErrorBoundary>} />
            <Route path="demo-analytics" element={<ErrorBoundary><PlatformDemoAnalyticsPage /></ErrorBoundary>} />
            <Route path="daily-ops-reports" element={<ErrorBoundary><PlatformDailyOpsReportsPage /></ErrorBoundary>} />
            <Route path="suspensions" element={<ErrorBoundary><PlatformJudicialSuspensionsPage /></ErrorBoundary>} />
            <Route path="admin-alerts" element={<ErrorBoundary><PlatformAdminAlertsPage /></ErrorBoundary>} />
            <Route path="coverage-gaps" element={<ErrorBoundary><PlatformCoverageGapsPage /></ErrorBoundary>} />
            <Route path="waitlist" element={<ErrorBoundary><PlatformWaitlistPage /></ErrorBoundary>} />
            <Route path="pdf-settings" element={<ErrorBoundary><PlatformPdfSettingsPage /></ErrorBoundary>} />
            <Route path="generic-signing" element={<ErrorBoundary><PlatformGenericSigningPage /></ErrorBoundary>} />
            <Route path="generic-signing-docs" element={<ErrorBoundary><PlatformGenericSigningDocsPage /></ErrorBoundary>} />
            <Route path="hearings-catalog" element={<ErrorBoundary><PlatformHearingsCatalogPage /></ErrorBoundary>} />
            <Route path="notification-dispatch" element={<ErrorBoundary><PlatformNotificationDispatchPage /></ErrorBoundary>} />

            <Route path="auth-providers" element={<ErrorBoundary><PlatformAuthProvidersPage /></ErrorBoundary>} />
            <Route path="billing-test" element={
              <OrganizationProvider>
                <SubscriptionProvider>
                  <ErrorBoundary><BillingTestConsole /></ErrorBoundary>
                </SubscriptionProvider>
              </OrganizationProvider>
            } />
          </Route>
          
          {/* 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
