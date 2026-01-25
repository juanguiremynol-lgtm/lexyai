/**
 * Platform Console - Global Super Admin Panel
 * 
 * Only accessible to platform superadmins (ATENIA operators).
 * Provides cross-organization management capabilities.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Building2, 
  Crown, 
  Users, 
  History, 
  Mail, 
  Activity,
  ShieldAlert,
  Lock
} from "lucide-react";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";

// Platform Console Tab Components
import { PlatformOrganizationsTab } from "./tabs/PlatformOrganizationsTab";
import { PlatformSubscriptionsTab } from "./tabs/PlatformSubscriptionsTab";
import { PlatformUsersTab } from "./tabs/PlatformUsersTab";
import { PlatformAuditLogsTab } from "./tabs/PlatformAuditLogsTab";
import { PlatformEmailOpsTab } from "./tabs/PlatformEmailOpsTab";
import { PlatformSystemHealthTab } from "./tabs/PlatformSystemHealthTab";

export function PlatformConsole() {
  const { isPlatformAdmin, isLoading } = usePlatformAdmin();

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Verificando acceso...</p>
      </div>
    );
  }

  // Access denied for non-platform admins
  if (!isPlatformAdmin) {
    return (
      <Card className="max-w-lg mx-auto mt-12">
        <CardHeader className="text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Acceso Denegado</CardTitle>
          <CardDescription>
            La Consola de Plataforma está reservada exclusivamente para administradores del sistema ATENIA.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <h2 className="text-2xl font-serif font-bold">Consola de Plataforma</h2>
          <p className="text-muted-foreground text-sm">
            Administración global del sistema ATENIA
          </p>
        </div>
      </div>

      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          <span><strong>Modo Super Admin:</strong> Todas las acciones quedan registradas en auditoría.</span>
        </p>
      </div>

      <Tabs defaultValue="organizations" className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1 bg-card/50 p-1">
          <TabsTrigger value="organizations" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Organizaciones</span>
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-2">
            <Crown className="h-4 w-4" />
            <span className="hidden sm:inline">Suscripciones</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Usuarios</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Auditoría Global</span>
          </TabsTrigger>
          <TabsTrigger value="email-ops" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Correos</span>
          </TabsTrigger>
          <TabsTrigger value="system" className="gap-2">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Sistema</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="organizations">
          <PlatformOrganizationsTab />
        </TabsContent>

        <TabsContent value="subscriptions">
          <PlatformSubscriptionsTab />
        </TabsContent>

        <TabsContent value="users">
          <PlatformUsersTab />
        </TabsContent>

        <TabsContent value="audit">
          <PlatformAuditLogsTab />
        </TabsContent>

        <TabsContent value="email-ops">
          <PlatformEmailOpsTab />
        </TabsContent>

        <TabsContent value="system">
          <PlatformSystemHealthTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
