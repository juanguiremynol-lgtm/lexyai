/**
 * Platform Layout - Separate dark noir layout for Platform Console
 * Used exclusively by platform admins (ATENIA operators)
 */

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
  "/platform/support": "Modo Soporte",
  "/platform/users": "Usuarios",
  "/platform/audit": "Auditoría",
  "/platform/email-ops": "Operaciones de Email",
  "/platform/system": "Estado del Sistema",
  "/platform/api-debug": "API Debug",
  "/platform/atenia-ai": "Atenia AI Supervisor",
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
          <header className="h-14 border-b border-white/10 bg-black/90 backdrop-blur-sm flex items-center px-6 gap-3 sticky top-0 z-10">
            <ShieldAlert className="h-5 w-5 text-cyan-400" />
            <span className="font-semibold text-white tracking-tight" style={{ fontFamily: "'JetBrains Mono', monospace" }}>PLATFORM</span>
            <span className="text-white/20 mx-1">—</span>
            <span className="text-white/70 font-medium">{pageTitle}</span>
            <div className="ml-auto px-3 py-1 bg-white/5 border border-white/10 rounded">
              <span className="text-xs text-cyan-400 font-mono tracking-widest uppercase">Admin</span>
            </div>
          </header>
          
          {/* Main content area with dark background */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-950 platform-console-main">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
