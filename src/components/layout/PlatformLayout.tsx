/**
 * Platform Layout - Fixed grey-scale theme for Platform Console
 * Used exclusively by platform admins (ATENIA operators)
 * 
 * Theme: Grey-scale primary with blue/red high-legibility accents
 * This theme is NOT affected by user preferences - all super admins see the same colors
 */

import { useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { PlatformSidebar } from "./PlatformSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

// Map routes to page titles
const routeTitles: Record<string, string> = {
  "/platform/verification": "Verificación del Sistema",
  "/platform/metrics": "Métricas SaaS",
  "/platform/organizations": "Organizaciones",
  "/platform/subscriptions": "Suscripciones",
  "/platform/vouchers": "Vouchers de Cortesía",
  "/platform/limits": "Límites de Planes",
  "/platform/ai-settings": "Configuración de IA",
  "/platform/support": "Modo Soporte",
  "/platform/users": "Usuarios",
  "/platform/audit": "Auditoría",
  "/platform/email-ops": "Operaciones de Email",
  "/platform/system": "Estado del Sistema",
  "/platform/api-debug": "API Debug",
};

export function PlatformLayout() {
  const location = useLocation();
  const pageTitle = routeTitles[location.pathname] || "Consola de Plataforma";

  // Force platform-console theme, overriding user preferences
  useEffect(() => {
    // Store original theme class
    const originalClasses = document.documentElement.className;
    
    // Remove any existing theme classes and add platform-console
    document.documentElement.classList.remove('light', 'dark', 'matrix', 'aqua');
    document.documentElement.classList.add('platform-console');
    
    // Cleanup: restore original theme when leaving platform console
    return () => {
      document.documentElement.classList.remove('platform-console');
      // Restore previous classes
      originalClasses.split(' ').forEach(cls => {
        if (cls && ['light', 'dark', 'matrix', 'aqua'].includes(cls)) {
          document.documentElement.classList.add(cls);
        }
      });
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <PlatformSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          {/* Platform Console Header - Blue accent */}
          <header className="h-14 border-b border-[hsl(210_100%_50%/0.2)] bg-[hsl(220_15%_10%/0.95)] backdrop-blur-sm flex items-center px-6 gap-3 sticky top-0 z-10">
            <ShieldAlert className="h-5 w-5 text-[hsl(210_100%_55%)]" />
            <span className="font-semibold text-[hsl(210_100%_55%)]">ATENIA Platform Console</span>
            <span className="text-[hsl(220_8%_40%)] mx-2">|</span>
            <span className="text-[hsl(220_5%_85%)] font-medium">{pageTitle}</span>
            <div className="ml-auto px-3 py-1 bg-[hsl(210_100%_50%/0.1)] border border-[hsl(210_100%_50%/0.2)] rounded-full">
              <span className="text-xs text-[hsl(210_100%_55%)] font-medium tracking-wide">Super Admin Mode</span>
            </div>
          </header>
          
          {/* Main content area with grey background */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-[hsl(220_15%_6%)]">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
