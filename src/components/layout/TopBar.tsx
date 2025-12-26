import { Bell, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ColombianClock } from "./ColombianClock";
import logo from "@/assets/logo.png";

export function TopBar() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/processes?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="-ml-1" />
        
        <img 
          src={logo} 
          alt="Lex et Lit" 
          className="h-10 w-auto object-contain hidden md:block"
        />
        <form onSubmit={handleSearch} className="hidden md:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por radicado, cliente, juzgado..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 lg:w-80 pl-9 bg-background"
            />
          </div>
        </form>
      </div>

      <div className="flex items-center gap-3">
        <ColombianClock />

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => navigate('/alerts')}
        >
          <Bell className="h-5 w-5" />
          {unreadAlerts > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-sla-critical text-[10px] font-bold text-white">
              {unreadAlerts > 9 ? '9+' : unreadAlerts}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}
