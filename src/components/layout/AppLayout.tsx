import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet } from "react-router-dom";
import { EstadosTicker } from "@/components/ticker";
import { RenewalTickerTop, RenewalTickerBottom } from "@/components/billing/RenewalTicker";
import { ProfileBubble } from "@/components/profile/ProfileBubble";
import { SuspendedPaywall } from "@/components/billing/SuspendedPaywall";
import { BetaTrialBanner } from "@/components/billing/BetaTrialBanner";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { ensureUserOrganization, backfillOrganizationId, autoPopulateProfileFromOAuth } from "@/lib/onboarding-service";

export function AppLayout() {
  const { theme } = useTheme();
  const isAquaTheme = theme === "aqua";

  // Ensure user has an organization on first load
  useEffect(() => {
    const initOrganization = async () => {
      const result = await ensureUserOrganization();
      if (result.success && result.organizationId) {
        await backfillOrganizationId(result.organizationId);
      }
      // Auto-populate profile from OAuth claims (only fills empty fields)
      await autoPopulateProfileFromOAuth();
    };
    initOrganization();
  }, []);

  return (
    <SidebarProvider defaultOpen={false}>
      {/* Root container - app-content class ensures it renders above overlays */}
      <div className={cn(
        "app-content flex min-h-screen w-full",
        isAquaTheme && "relative z-[1]"
      )}>
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          <RenewalTickerTop />
          <BetaTrialBanner />
          <EstadosTicker />
          <TopBar />
          {/* Main content area - transparent for aqua theme */}
          <main className={cn(
            "flex-1 overflow-y-auto p-4 lg:p-6",
            isAquaTheme ? "bg-transparent" : "bg-background"
          )}>
            <Outlet />
          </main>
          <RenewalTickerBottom />
        </SidebarInset>
      </div>
      {/* Suspended paywall overlays everything */}
      <SuspendedPaywall />
      <ProfileBubble />
    </SidebarProvider>
  );
}
