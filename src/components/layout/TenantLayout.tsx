/**
 * Tenant Layout - Layout for tenant users (normal app users)
 * Wraps the standard AppLayout with tenant-specific providers
 */

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet } from "react-router-dom";
import { EstadosTicker } from "@/components/ticker";
import { SubscriptionBanner } from "@/components/subscription/SubscriptionBanner";
import { DailyWelcomeDialog } from "@/components/daily-welcome";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { ensureUserOrganization, backfillOrganizationId } from "@/lib/onboarding-service";
import { useLoginSync } from "@/hooks/useLoginSync";

export function TenantLayout() {
  const { theme } = useTheme();
  const isAquaTheme = theme === "aqua";

  // Trigger automatic sync on login
  useLoginSync();

  // Ensure user has an organization on first load
  useEffect(() => {
    const initOrganization = async () => {
      const result = await ensureUserOrganization();
      if (result.success && result.organizationId) {
        // Backfill organization_id for existing data
        await backfillOrganizationId(result.organizationId);
      }
    };
    initOrganization();
  }, []);

  return (
    <SidebarProvider>
      {/* Root container - app-content class ensures it renders above overlays */}
      <div className={cn(
        "app-content flex min-h-screen w-full",
        isAquaTheme && "relative z-[1]"
      )}>
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          <SubscriptionBanner />
          <EstadosTicker />
          <TopBar />
          {/* Main content area - transparent for aqua theme */}
          <main className={cn(
            "flex-1 overflow-y-auto p-4 lg:p-6",
            isAquaTheme ? "bg-transparent" : "bg-background"
          )}>
            <Outlet />
          </main>
        </SidebarInset>
      </div>
      
      {/* Daily Welcome Dialog - shows AI summary on business days */}
      <DailyWelcomeDialog />
    </SidebarProvider>
  );
}
