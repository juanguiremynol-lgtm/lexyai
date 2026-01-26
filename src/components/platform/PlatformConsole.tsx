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
  Lock,
  BarChart3,
  Ticket,
  Eye,
  Gauge,
  ShieldCheck
} from "lucide-react";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";

// Platform Console Tab Components
import { PlatformOrganizationsTab } from "./tabs/PlatformOrganizationsTab";
import { PlatformSubscriptionsTab } from "./tabs/PlatformSubscriptionsTab";
import { PlatformUsersTab } from "./tabs/PlatformUsersTab";
import { PlatformAuditLogsTab } from "./tabs/PlatformAuditLogsTab";
import { PlatformEmailOpsTab } from "./tabs/PlatformEmailOpsTab";
import { PlatformSystemHealthTab } from "./tabs/PlatformSystemHealthTab";
import { PlatformVerificationTab } from "./tabs/PlatformVerificationTab";
import { PlatformSaaSMetricsTab } from "./tabs/PlatformSaaSMetricsTab";
import { PlatformVouchersTab } from "./tabs/PlatformVouchersTab";
import { PlatformImpersonationTab } from "./tabs/PlatformImpersonationTab";
import { PlatformPlanLimitsTab } from "./tabs/PlatformPlanLimitsTab";

interface PlatformConsoleProps {
  defaultTab?: string;
}

export function PlatformConsole({ defaultTab = "verification" }: PlatformConsoleProps) {
  const { isPlatformAdmin, isLoading } = usePlatformAdmin();

  // Loading state - the route guard already checks but we double-check here
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Verificando acceso...</p>
      </div>
    );
  }

  // Access denied for non-platform admins (fallback - route guard should catch this)
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
          <h2 className="text-2xl font-serif font-bold text-foreground">Consola de Plataforma</h2>
          <p className="text-muted-foreground text-sm">
            Administración global del sistema ATENIA
          </p>
        </div>
      </div>

      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          <span><strong>Modo Super Admin:</strong> Todas las acciones quedan registradas en auditoría.</span>
        </p>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1 bg-card/50 p-1">
          <TabsTrigger value="verification" className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Verificación</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Métricas SaaS</span>
          </TabsTrigger>
          <TabsTrigger value="organizations" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">Organizaciones</span>
          </TabsTrigger>
          <TabsTrigger value="subscriptions" className="gap-2">
            <Crown className="h-4 w-4" />
            <span className="hidden sm:inline">Suscripciones</span>
          </TabsTrigger>
          <TabsTrigger value="vouchers" className="gap-2">
            <Ticket className="h-4 w-4" />
            <span className="hidden sm:inline">Vouchers</span>
          </TabsTrigger>
          <TabsTrigger value="limits" className="gap-2">
            <Gauge className="h-4 w-4" />
            <span className="hidden sm:inline">Límites</span>
          </TabsTrigger>
          <TabsTrigger value="impersonation" className="gap-2">
            <Eye className="h-4 w-4" />
            <span className="hidden sm:inline">Soporte</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Usuarios</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-2">
            <History className="h-4 w-4" />
            <span className="hidden sm:inline">Auditoría</span>
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

        <TabsContent value="verification">
          <PlatformVerificationTab />
        </TabsContent>

        <TabsContent value="metrics">
          <PlatformSaaSMetricsTab />
        </TabsContent>

        <TabsContent value="organizations">
          <PlatformOrganizationsTab />
        </TabsContent>

        <TabsContent value="subscriptions">
          <PlatformSubscriptionsTab />
        </TabsContent>

        <TabsContent value="vouchers">
          <PlatformVouchersTab />
        </TabsContent>

        <TabsContent value="limits">
          <PlatformPlanLimitsTab />
        </TabsContent>

        <TabsContent value="impersonation">
          <PlatformImpersonationTab />
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
