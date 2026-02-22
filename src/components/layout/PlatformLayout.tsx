/**
 * Platform Layout - Separate dark noir layout for Platform Console
 * Used exclusively by platform admins (ATENIA operators)
 */

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { PlatformSidebar } from "./PlatformSidebar";
import { Outlet, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { LaunchStatusIndicator } from "@/components/launch/LaunchStatusIndicator";

// Map routes to page titles
const routeTitles: Record<string, string> = {
  "/platform/notifications": "Notificaciones",
  "/platform/verification": "Verificación del Sistema",
  "/platform/metrics": "Métricas SaaS",
  "/platform/organizations": "Organizaciones",
  "/platform/subscriptions": "Suscripciones",
  "/platform/vouchers": "Vouchers de Cortesía",
  "/platform/limits": "Límites de Planes",
  "/platform/support": "Modo Soporte",
  "/platform/users": "Usuarios",
  "/platform/audit": "Auditoría",
  "/platform/email-ops": "Operaciones de Email",
  "/platform/email-provider": "Integración de Proveedor de Email",
  "/platform/system": "Estado del Sistema",
  "/platform/atenia-ai": "Andro IA — Centro de Comando",
  "/platform/daily-ops-reports": "Reportes Diarios de Operaciones",
  "/platform/suspensions": "Suspensiones Judiciales",
  "/platform/waitlist": "Lista de Espera",
  "/platform/pdf-settings": "PDF / Gotenberg",
};

export function PlatformLayout() {
  const location = useLocation();
  const pageTitle = routeTitles[location.pathname] || "Consola de Plataforma";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full platform-console-root">
        <PlatformSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          {/* Platform Console Header */}
          <header className="h-14 border-b border-white/20 bg-black flex items-center px-6 gap-3 sticky top-0 z-10">
            <ShieldAlert className="h-5 w-5 text-cyan-400" />
            <span className="font-semibold text-white tracking-widest text-xs uppercase" style={{ fontFamily: "'JetBrains Mono', monospace" }}>PLATFORM</span>
            <span className="text-white/30 mx-1">|</span>
            <span className="text-white/80 text-xs uppercase tracking-wide" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{pageTitle}</span>
            <div className="ml-auto flex items-center gap-3">
              <LaunchStatusIndicator />
              <div className="px-3 py-1 border border-cyan-400/40 rounded-none">
                <span className="text-xs text-cyan-400 font-mono tracking-widest uppercase">ADMIN</span>
              </div>
            </div>
          </header>
          
          {/* Main content area with dark background */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-black platform-console-main">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
