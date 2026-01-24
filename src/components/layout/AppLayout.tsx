import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet } from "react-router-dom";
import { EstadosTicker } from "@/components/ticker";

export function AppLayout() {
  return (
    <SidebarProvider>
      {/* Root container: allow natural width, no global overflow lock */}
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
          <EstadosTicker />
          <TopBar />
          {/* Main content area - allows child components to define their own scroll behavior */}
          <main className="flex-1 overflow-y-auto bg-background p-4 lg:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
