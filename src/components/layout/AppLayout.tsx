import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { Outlet } from "react-router-dom";
import { EstadosTicker } from "@/components/ticker";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const { theme } = useTheme();
  const isAquaTheme = theme === "aqua";

  return (
    <SidebarProvider>
      {/* Root container - app-content class ensures it renders above overlays */}
      <div className={cn(
        "app-content flex min-h-screen w-full",
        isAquaTheme && "relative z-[1]"
      )}>
        <AppSidebar />
        <SidebarInset className="flex flex-1 flex-col min-w-0">
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
    </SidebarProvider>
  );
}
