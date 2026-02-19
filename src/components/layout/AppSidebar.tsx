import { 
  LayoutDashboard, 
  Briefcase, 
  CheckSquare, 
  Bell, 
  Settings,
  Scale,
  LogOut,
  Wrench,
  CalendarDays,
  Link2,
  ShieldAlert,
  Newspaper,
  Mail,
} from "lucide-react";
import logo from "@/assets/andromeda-logo.png";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { useHoyCounts } from "@/hooks/use-hoy-counts";
import { Badge } from "@/components/ui/badge";

// All tenant nav items now use /app/* prefix
const navItems = [
  { title: "Dashboard", url: "/app/dashboard", icon: LayoutDashboard },
  { title: "Clientes", url: "/app/clients", icon: Briefcase },
  { title: "Procesos", url: "/app/processes", icon: Scale },
  { title: "Estados de Hoy", url: "/app/estados-hoy", icon: Newspaper, countKey: 'estados' as const },
  { title: "Actuaciones de Hoy", url: "/app/actuaciones-hoy", icon: Scale, countKey: 'actuaciones' as const },
  { title: "Audiencias", url: "/app/hearings", icon: CalendarDays },
  { title: "Tareas", url: "/app/tasks", icon: CheckSquare },
  { title: "Alertas", url: "/app/alerts", icon: Bell },
  { title: "Utilidades", url: "/app/utilities", icon: Wrench },
  { title: "Enlaces", url: "/app/links", icon: Link2 },
];

const settingsItems = [
  { title: "Configuración", url: "/app/settings", icon: Settings },
];

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  countKey?: 'estados' | 'actuaciones';
};

function SidebarNavItemsList({ items, currentPath }: { items: NavItem[]; currentPath: string }) {
  const { estadosCount, actuacionesCount } = useHoyCounts();
  const counts: Record<string, number> = { estados: estadosCount, actuaciones: actuacionesCount };

  return (
    <>
      {items.map((item) => {
        const isActive = currentPath === item.url || currentPath.startsWith(item.url + '/');
        const count = item.countKey ? counts[item.countKey] : 0;
        return (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              asChild
              isActive={isActive}
              tooltip={item.title}
              className={cn(
                "transition-all duration-200",
                isActive && "bg-primary/15 text-primary border-l-2 border-primary"
              )}
            >
              <NavLink to={item.url} className="flex items-center gap-3">
                <item.icon className={cn(
                  "h-4 w-4 transition-colors",
                  isActive ? "text-primary" : "text-sidebar-foreground/70"
                )} />
                <span className={cn(
                  "flex-1",
                  isActive ? "text-primary font-medium" : "text-sidebar-foreground"
                )}>
                  {item.title}
                </span>
                {item.countKey && count > 0 && (
                  <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-bold">
                    {count > 99 ? '99+' : count}
                  </Badge>
                )}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { isPlatformAdmin } = usePlatformAdmin();

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Error al cerrar sesión");
    } else {
      navigate("/auth");
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/50 sidebar-glass">
      <SidebarHeader className="border-b border-primary/20">
        <div className={cn(
          "flex items-center gap-3 px-3 py-4",
          collapsed && "justify-center"
        )}>
          <div className={cn(
            "relative",
            collapsed ? "h-10 w-10" : "h-16 w-auto"
          )}>
            <img 
              src={logo} 
              alt="Andromeda" 
              className="h-full w-auto object-contain"
            />
            <div className="absolute inset-0 -z-10 blur-xl bg-primary/10 rounded-full" />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-primary/80 text-xs uppercase tracking-widest font-medium">
            Navegación
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarNavItemsList items={navItems} currentPath={location.pathname} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-primary/80 text-xs uppercase tracking-widest font-medium">
            Sistema
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={cn(
                        "transition-all duration-200",
                        isActive && "bg-primary/15 text-primary border-l-2 border-primary"
                      )}
                    >
                      <NavLink to={item.url} className="flex items-center gap-3">
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors",
                          isActive ? "text-primary" : "text-sidebar-foreground/70"
                        )} />
                        <span className={cn(
                          isActive ? "text-primary font-medium" : "text-sidebar-foreground"
                        )}>
                          {item.title}
                        </span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              
              {/* Platform Console - Only visible to platform admins */}
              {isPlatformAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith("/platform")}
                    tooltip="Platform Console"
                    className={cn(
                      "transition-all duration-200",
                      location.pathname.startsWith("/platform") && "bg-amber-500/15 text-amber-500 border-l-2 border-amber-500"
                    )}
                  >
                    <NavLink to="/platform" className="flex items-center gap-3">
                      <ShieldAlert className={cn(
                        "h-4 w-4 transition-colors",
                        location.pathname.startsWith("/platform") ? "text-amber-500" : "text-amber-500/70"
                      )} />
                      <span className={cn(
                        location.pathname.startsWith("/platform") ? "text-amber-500 font-medium" : "text-amber-500/80"
                      )}>
                        Platform Console
                      </span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-primary/20 px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Cerrar sesión"
              className="text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
            >
              <LogOut className="h-4 w-4" />
              <span>Cerrar sesión</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
