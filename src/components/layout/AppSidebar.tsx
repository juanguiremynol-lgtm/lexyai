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
} from "lucide-react";
import logo from "@/assets/atenia-logo.png";
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
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Clientes", url: "/clients", icon: Briefcase },
  { title: "Procesos", url: "/processes", icon: Scale },
  { title: "Audiencias", url: "/hearings", icon: CalendarDays },
  { title: "Tareas", url: "/tasks", icon: CheckSquare },
  { title: "Alertas", url: "/alerts", icon: Bell },
  { title: "Utilidades", url: "/utilities", icon: Wrench },
  { title: "Enlaces", url: "/links", icon: Link2 },
];

const settingsItems = [
  { title: "Configuración", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

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
              alt="ATENIA" 
              className="h-full w-auto object-contain"
            />
            {/* Glow effect behind logo */}
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
              {navItems.map((item) => {
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