/**
 * Admin Console - Centralized admin panel for organization management
 * Only visible to OWNER and ADMIN roles
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, 
  Crown, 
  Mail, 
  Trash2, 
  Activity, 
  Shield, 
  Wrench,
  History,
  Lock,
  Bell
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";

// Admin Console Tab Components
import { AdminMembersTab } from "./tabs/AdminMembersTab";
import { AdminSubscriptionTab } from "./tabs/AdminSubscriptionTab";
import { AdminInvitesTab } from "./tabs/AdminInvitesTab";
import { AdminDataLifecycleTab } from "./tabs/AdminDataLifecycleTab";
import { AdminEmailOperationsTab } from "./tabs/AdminEmailOperationsTab";
import { AdminSystemHealthTab } from "./tabs/AdminSystemHealthTab";
import { AdminSecurityTab } from "./tabs/AdminSecurityTab";
import { AdminSupportToolsTab } from "./tabs/AdminSupportToolsTab";
import { AdminAuditLogsTab } from "./tabs/AdminAuditLogsTab";
import { AdminAlertsTab } from "./tabs/AdminAlertsTab";

export function AdminConsole() {
  const { organization } = useOrganization();
  const { isOwner, isAdmin } = useOrganizationMembership(organization?.id || null);

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
          <TabsTrigger value="subscription" className="gap-2">
            <Crown className="h-4 w-4" />
            <span className="hidden sm:inline">Suscripción</span>
          </TabsTrigger>
          <TabsTrigger value="invites" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Invitaciones</span>
          </TabsTrigger>
          <TabsTrigger value="data-lifecycle" className="gap-2">
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">Datos</span>
          </TabsTrigger>
          <TabsTrigger value="email-ops" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Correos</span>
          </TabsTrigger>
          <TabsTrigger value="health" className="gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Sistema</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-2">
            <Shield className="h-4 w-4" />
            <span className="hidden sm:inline">Seguridad</span>
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Alertas</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Auditoría</span>
          </TabsTrigger>
          <TabsTrigger value="support" className="gap-2">
            <Wrench className="h-4 w-4" />
            <span className="hidden sm:inline">Soporte</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <AdminMembersTab />
        </TabsContent>

        <TabsContent value="subscription">
          <AdminSubscriptionTab />
        </TabsContent>

        <TabsContent value="invites">
          <AdminInvitesTab />
        </TabsContent>

        <TabsContent value="data-lifecycle">
          <AdminDataLifecycleTab />
        </TabsContent>

        <TabsContent value="email-ops">
          <AdminEmailOperationsTab />
        </TabsContent>

        <TabsContent value="health">
          <AdminSystemHealthTab />
        </TabsContent>

        <TabsContent value="security">
          <AdminSecurityTab />
        </TabsContent>

        <TabsContent value="alerts">
          <AdminAlertsTab />
        </TabsContent>

        <TabsContent value="audit">
          <AdminAuditLogsTab />
        </TabsContent>

        <TabsContent value="support">
          <AdminSupportToolsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}