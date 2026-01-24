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
      {/* Root container with aqua theme wallpaper support */}
      <div className={cn(
        "flex min-h-screen w-full",
        isAquaTheme && "aqua-shell"
      )}>
        {/* Overlay layers for aqua theme */}
        {isAquaTheme && (
          <>
            <div className="aqua-overlay-gradient" aria-hidden="true" />
            <div className="aqua-overlay-vignette" aria-hidden="true" />
          </>
        )}
        
        <AppSidebar />
        <SidebarInset className={cn(
          "flex flex-1 flex-col min-w-0",
          isAquaTheme && "relative z-[1]"
        )}>
          <EstadosTicker />
          <TopBar />
          {/* Main content area */}
          <main className="flex-1 overflow-y-auto bg-background/80 p-4 lg:p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
