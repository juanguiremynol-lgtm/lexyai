/**
 * Platform Sidebar - Navigation for Platform Console
 * Completely separate from tenant navigation
 */

import { 
  LayoutDashboard, 
  Building2,
  Crown,
  Users,
  History,
  Mail,
  Activity,
  ShieldCheck,
  Ticket,
  Gauge,
  Eye,
  LogOut,
  ArrowLeft,
  BarChart3,
} from "lucide-react";
import logo from "@/assets/atenia-logo.png";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
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
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const platformNavItems = [
  { title: "Verificación", url: "/platform", icon: ShieldCheck },
  { title: "Métricas SaaS", url: "/platform/metrics", icon: BarChart3 },
  { title: "Organizaciones", url: "/platform/organizations", icon: Building2 },
  { title: "Suscripciones", url: "/platform/subscriptions", icon: Crown },
  { title: "Vouchers", url: "/platform/vouchers", icon: Ticket },
  { title: "Límites", url: "/platform/limits", icon: Gauge },
  { title: "Soporte", url: "/platform/support", icon: Eye },
  { title: "Usuarios", url: "/platform/users", icon: Users },
  { title: "Auditoría", url: "/platform/audit", icon: History },
  { title: "Email Ops", url: "/platform/email-ops", icon: Mail },
  { title: "Sistema", url: "/platform/system", icon: Activity },
];

export function PlatformSidebar() {
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

  const isActive = (url: string) => {
    if (url === "/platform") {
      return location.pathname === "/platform";
    }
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-amber-500/30 bg-slate-950/95">
      <SidebarHeader className="border-b border-amber-500/30">
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
              alt="ATENIA Platform" 
              className="h-full w-auto object-contain"
            />
          </div>
          {!collapsed && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/30">
              Platform
            </Badge>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-amber-500/80 text-xs uppercase tracking-widest font-medium">
            Consola de Plataforma
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformNavItems.map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.title}
                      className={cn(
                        "transition-all duration-200",
                        active && "bg-amber-500/15 text-amber-500 border-l-2 border-amber-500"
                      )}
                    >
                      <NavLink to={item.url} className="flex items-center gap-3">
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors",
                          active ? "text-amber-500" : "text-slate-400"
                        )} />
                        <span className={cn(
                          active ? "text-amber-500 font-medium" : "text-slate-300"
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

      <SidebarFooter className="border-t border-amber-500/30 px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => navigate("/app/dashboard")}
              tooltip="Volver a App"
              className="text-slate-400 hover:text-primary hover:bg-primary/10 transition-all duration-200"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Volver a App</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Cerrar sesión"
              className="text-slate-400 hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
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
