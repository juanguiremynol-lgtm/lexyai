import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet } from "react-router-dom";
import { EstadosTicker } from "@/components/ticker";

export function AppLayout() {
  return (
    <SidebarProvider>
      {/* Root container: block page-wide horizontal overflow */}
      <div className="flex min-h-screen w-full max-w-full overflow-x-hidden">
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0 max-w-full overflow-x-hidden">
          <EstadosTicker />
          <TopBar />
          <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 lg:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
