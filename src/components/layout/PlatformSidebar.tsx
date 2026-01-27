/**
 * Platform Sidebar - Navigation for Platform Console
 * Dark noir theme with amber accents
 */

import { 
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
  Bug,
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
  { title: "Verificación", url: "/platform/verification", icon: ShieldCheck },
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
  { title: "API Debug", url: "/platform/api-debug", icon: Bug },
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
    return location.pathname === url;
  };

  return (
    <Sidebar 
      collapsible="icon" 
      className="border-r border-slate-800 bg-slate-950"
    >
      <SidebarHeader className="border-b border-slate-800 bg-slate-950">
        <div className={cn(
          "flex items-center gap-3 px-3 py-4",
          collapsed && "justify-center"
        )}>
          <div className={cn(
            "relative",
            collapsed ? "h-10 w-10" : "h-14 w-auto"
          )}>
            <img 
              src={logo} 
              alt="ATENIA Platform" 
              className="h-full w-auto object-contain"
            />
          </div>
          {!collapsed && (
            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30">
              Platform
            </Badge>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 bg-slate-950">
        <SidebarGroup>
          <SidebarGroupLabel className="text-amber-500/70 text-xs uppercase tracking-widest font-semibold px-3 py-2">
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
                        "transition-all duration-200 rounded-lg my-0.5",
                        active 
                          ? "bg-amber-500/15 text-amber-400 border-l-2 border-amber-500" 
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                      )}
                    >
                      <NavLink to={item.url} className="flex items-center gap-3 px-3 py-2">
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors shrink-0",
                          active ? "text-amber-400" : "text-slate-500"
                        )} />
                        <span className={cn(
                          "transition-colors",
                          active ? "text-amber-400 font-medium" : "text-slate-300"
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

      <SidebarFooter className="border-t border-slate-800 px-2 bg-slate-950">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => navigate("/app/dashboard")}
              tooltip="Volver a App"
              className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all duration-200 rounded-lg"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Volver a App</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Cerrar sesión"
              className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200 rounded-lg"
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
