/**
 * Platform Layout - Separate layout for Platform Console
 * Used exclusively by platform admins
 */

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { PlatformSidebar } from "./PlatformSidebar";
import { Outlet } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

export function PlatformLayout() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-slate-950">
        <PlatformSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          {/* Platform Console Header */}
          <div className="h-14 border-b border-amber-500/30 bg-slate-900/80 flex items-center px-6 gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <span className="font-semibold text-amber-500">ATENIA Platform Console</span>
            <div className="ml-auto px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full">
              <span className="text-xs text-amber-500">Super Admin Mode</span>
            </div>
          </div>
          
          {/* Main content area */}
          <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-slate-950">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
