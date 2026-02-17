import { SidebarTrigger } from "@/components/ui/sidebar";
import { ColombianClock } from "./ColombianClock";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { SuperAdminToolbar } from "./SuperAdminToolbar";
import logo from "@/assets/andromeda-logo.png";

export function TopBar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6 w-full max-w-full overflow-hidden">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <SidebarTrigger className="-ml-1 flex-shrink-0" />
        
        <img 
          src={logo} 
          alt="Andromeda" 
          className="h-12 w-auto object-contain hidden md:block flex-shrink-0"
        />
        
        <div className="hidden md:block min-w-0 flex-1 max-w-md">
          <GlobalSearch />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <ColombianClock />

        <ThemeToggle />

        {/* Super Admin Exclusive Tools (only for platform admins) */}
        <SuperAdminToolbar />

        {/* Single unified notification bell (role-adaptive content) */}
        <NotificationCenter />
      </div>
    </header>
  );
}
