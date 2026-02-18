/**
 * Admin Console - Centralized admin panel for organization management
 * Only visible to OWNER and ADMIN roles
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, 
  Mail, 
  Trash2, 
   
  Shield, 
  Wrench,
  History,
  Lock,
  BarChart3,
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Admin Console Tab Components
import { AdminMembersTab } from "./tabs/AdminMembersTab";
import { AdminInvitesTab } from "./tabs/AdminInvitesTab";
import { AdminDataLifecycleTab } from "./tabs/AdminDataLifecycleTab";


import { AdminSecurityTab } from "./tabs/AdminSecurityTab";
import { AdminSupportToolsTab } from "./tabs/AdminSupportToolsTab";
import { AdminAuditLogsTab } from "./tabs/AdminAuditLogsTab";
import { AdminAnalyticsTab } from "./tabs/AdminAnalyticsTab";

export function AdminConsole() {
  const { organization } = useOrganization();
  const { isOwner, isAdmin } = useOrganizationMembership(organization?.id || null);
  const { isPlatformAdmin } = usePlatformAdmin();

  // Check if audit tab is unlocked via Andro IA (for org admins)
  const { data: auditUnlocked } = useQuery({
    queryKey: ["audit-tab-unlock"],
    queryFn: async () => {
      if (isPlatformAdmin) return true; // Super admins always have access
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data, error } = await supabase
        .from("danger_zone_unlocks")
        .select("id, expires_at")
        .eq("user_id", user.id)
        .gte("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(1);
      if (error) return false;
      return data && data.length > 0;
    },
    refetchInterval: 30_000,
  });

  const showAuditTab = isPlatformAdmin || !!auditUnlocked;

  // Access denied for non-admins
  if (!isAdmin && !isOwner) {
    return (
      <Card className="max-w-lg mx-auto mt-12">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Acceso Denegado</CardTitle>
          <CardDescription>
            Solo los propietarios y administradores de la organización pueden acceder a la Consola de Administración.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-2xl font-serif font-bold">Administración de Cuenta</h2>
          <p className="text-muted-foreground text-sm">
            Gestión de tu organización
          </p>
        </div>
      </div>

      <Tabs defaultValue="members" className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1 bg-card/50 p-1">
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Miembros</span>
          </TabsTrigger>
          <TabsTrigger value="invites" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Invitaciones</span>
          </TabsTrigger>
          <TabsTrigger value="data-lifecycle" className="gap-2">
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Datos</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Seguridad</span>
          </TabsTrigger>
          {showAuditTab && (
            <TabsTrigger value="audit" className="gap-2">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Auditoría</span>
            </TabsTrigger>
          )}
          {!isPlatformAdmin && (
            <TabsTrigger value="support" className="gap-2">
              <Wrench className="h-4 w-4" />
              <span className="hidden sm:inline">Soporte</span>
            </TabsTrigger>
          )}
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Analíticas</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <AdminMembersTab />
        </TabsContent>

        <TabsContent value="invites">
          <AdminInvitesTab />
        </TabsContent>

        <TabsContent value="data-lifecycle">
          <AdminDataLifecycleTab />
        </TabsContent>



        <TabsContent value="security">
          <AdminSecurityTab />
        </TabsContent>

        {showAuditTab && (
          <TabsContent value="audit">
            <AdminAuditLogsTab />
          </TabsContent>
        )}

        {!isPlatformAdmin && (
          <TabsContent value="support">
            <AdminSupportToolsTab />
          </TabsContent>
        )}

        <TabsContent value="analytics">
          <AdminAnalyticsTab />
        </TabsContent>

      </Tabs>
    </div>
  );
}