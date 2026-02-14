import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { ColombianClock } from "./ColombianClock";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalSearch } from "./GlobalSearch";
import { AdminNotificationBell } from "@/components/admin/AdminNotificationBell";
import { DataAlertBell } from "@/components/notifications/DataAlertBell";
import { SuperAdminToolbar } from "./SuperAdminToolbar";
import { useUnreadAlerts } from "@/hooks/use-unread-alerts";
import logo from "@/assets/andromeda-logo.png";

export function TopBar() {
  const navigate = useNavigate();
  const { unreadCount, markAllSeen } = useUnreadAlerts();

  const handleBellClick = () => {
    markAllSeen();
    navigate('/app/alerts');
  };

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

        {/* Admin Notification Bell (only shows for admins/owners) */}
        <AdminNotificationBell />

        {/* Data Freshness Alert Bell (all users) */}
        <DataAlertBell />

        <Button
          variant="ghost"
          size="icon"
          className="relative flex-shrink-0"
          onClick={handleBellClick}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}
