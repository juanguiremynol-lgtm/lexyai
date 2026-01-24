import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ColombianClock } from "./ColombianClock";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalSearch } from "./GlobalSearch";
import logo from "@/assets/atenia-logo.png";

export function TopBar() {
  const navigate = useNavigate();
  const [unreadAlerts, setUnreadAlerts] = useState(0);

  useEffect(() => {
    const fetchUnreadAlerts = async () => {
      const { count } = await supabase
        .from('alerts')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false);
      
      setUnreadAlerts(count || 0);
    };

    fetchUnreadAlerts();

    // Subscribe to changes
    const channel = supabase
      .channel('alerts-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'alerts' },
        () => fetchUnreadAlerts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6 w-full max-w-full overflow-hidden">
      <div className="flex items-center gap-4 min-w-0 flex-1">
        <SidebarTrigger className="-ml-1 flex-shrink-0" />
        
        <img 
          src={logo} 
          alt="ATENIA" 
          className="h-12 w-auto object-contain hidden md:block flex-shrink-0"
        />
        
        <div className="hidden md:block min-w-0 flex-1 max-w-md">
          <GlobalSearch />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <ColombianClock />

        <ThemeToggle />

        <Button
          variant="ghost"
          size="icon"
          className="relative flex-shrink-0"
          onClick={() => navigate('/alerts')}
        >
          <Bell className="h-5 w-5" />
          {unreadAlerts > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadAlerts > 9 ? '9+' : unreadAlerts}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}
