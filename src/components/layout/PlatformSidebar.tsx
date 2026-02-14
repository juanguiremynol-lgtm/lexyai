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
  Gauge,
  Eye,
  LogOut,
  ArrowLeft,
  BarChart3,
  Brain,
  Cable,
  CreditCard,
  Bell,
  Sparkles,
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
  { title: "Notificaciones", url: "/platform/notifications", icon: Bell },
  { title: "Verificación", url: "/platform/verification", icon: ShieldCheck },
  { title: "Métricas SaaS", url: "/platform/metrics", icon: BarChart3 },
  { title: "Organizaciones", url: "/platform/organizations", icon: Building2 },
  { title: "Facturación", url: "/platform/billing", icon: CreditCard },
  { title: "Suscripciones", url: "/platform/subscriptions", icon: Crown },
  { title: "Límites", url: "/platform/limits", icon: Gauge },
  { title: "Soporte", url: "/platform/support", icon: Eye },
  { title: "Usuarios", url: "/platform/users", icon: Users },
  { title: "Auditoría", url: "/platform/audit", icon: History },
  { title: "Email Ops", url: "/platform/email-ops", icon: Mail },
  { title: "Sistema", url: "/platform/system", icon: Activity },
  { title: "Atenia AI", url: "/platform/atenia-ai", icon: Brain },
  { title: "Gemini AI", url: "/platform/gemini", icon: Sparkles },
  { title: "Directorio", url: "/platform/courthouse-directory", icon: Building2 },
  { title: "Proveedores Ext.", url: "/platform/external-providers/wizard", icon: Cable },
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
      className="border-r border-white/10 bg-black"
    >
      <SidebarHeader className="border-b border-white/10 bg-black">
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
              className="h-full w-auto object-contain brightness-0 invert"
            />
          </div>
          {!collapsed && (
            <Badge className="bg-white/10 text-cyan-400 border-white/15 hover:bg-white/15 font-mono text-xs tracking-widest uppercase">
              Console
            </Badge>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 bg-black">
        <SidebarGroup>
          <SidebarGroupLabel className="text-white/30 text-[10px] uppercase tracking-[0.2em] font-mono px-3 py-2">
            Consola
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
                        "transition-all duration-150 rounded my-0.5",
                        active 
                          ? "bg-white/10 text-white border-l-2 border-cyan-400" 
                          : "text-white/50 hover:text-white/80 hover:bg-white/5"
                      )}
                    >
                      <NavLink to={item.url} className="flex items-center gap-3 px-3 py-2">
                        <item.icon className={cn(
                          "h-4 w-4 transition-colors shrink-0",
                          active ? "text-cyan-400" : "text-white/30"
                        )} />
                        <span className={cn(
                          "transition-colors text-sm",
                          active ? "text-white font-medium" : "text-white/60"
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

      <SidebarFooter className="border-t border-white/10 px-2 bg-black">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => navigate("/app/dashboard")}
              tooltip="Volver a App"
              className="text-white/40 hover:text-cyan-400 hover:bg-white/5 transition-all duration-150 rounded"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Volver a App</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Cerrar sesión"
              className="text-white/40 hover:text-red-400 hover:bg-red-500/8 transition-all duration-150 rounded"
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
