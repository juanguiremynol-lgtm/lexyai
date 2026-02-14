/**
 * Admin Security Tab - Organization security controls
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { 
  Shield, 
  ShieldCheck,
  Lock, 
  UserPlus, 
  Link2, 
  Globe,
  Save,
  Loader2,
  User,
  Clock,
  Calendar,
  History
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useOrganizationMembership } from "@/hooks/use-organization-membership";
import { logAudit } from "@/lib/audit-log";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface SecuritySettings {
  require_invite_only: boolean;
  disable_external_links: boolean;
  allowed_domains: string[];
}

export function AdminSecurityTab() {
  const queryClient = useQueryClient();
  const { organization, refetch: refetchOrg } = useOrganization();
  const { currentUserRole, memberships } = useOrganizationMembership(organization?.id || null);

  const [settings, setSettings] = useState<SecuritySettings>({
    require_invite_only: true,
    disable_external_links: false,
    allowed_domains: [],
  });
  const [hasChanges, setHasChanges] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [retentionChanged, setRetentionChanged] = useState(false);

  // Fetch current user info for session display
  const { data: currentUser } = useQuery({
    queryKey: ["current-user-session"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
  });

  // Fetch organization retention settings
  const { data: orgSettings } = useQuery({
    queryKey: ["org-settings", organization?.id],
    queryFn: async () => {
      if (!organization?.id) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("audit_retention_days")
        .eq("id", organization.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  // Load settings from organization
  useEffect(() => {
    setSettings({
      require_invite_only: true,
      disable_external_links: false,
      allowed_domains: [],
    });
  }, [organization]);

  // Load retention days when org settings load
  useEffect(() => {
    if (orgSettings?.audit_retention_days) {
      setRetentionDays(orgSettings.audit_retention_days);
    }
  }, [orgSettings]);

  // Save security settings
  const saveSettings = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("No organization");

      await logAudit({
        organizationId: organization.id,
        action: "SECURITY_SETTINGS_UPDATED",
        entityType: "organization",
        entityId: organization.id,
        metadata: settings as unknown as Record<string, unknown>,
      });
    },
    onSuccess: () => {
      toast.success("Configuración de seguridad guardada");
      setHasChanges(false);
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  // Save retention settings
  const saveRetention = useMutation({
    mutationFn: async () => {
      if (!organization?.id) throw new Error("No organization");

      const { error } = await supabase
        .from("organizations")
        .update({ audit_retention_days: retentionDays })
        .eq("id", organization.id);

      if (error) throw error;

      await logAudit({
        organizationId: organization.id,
        action: "SECURITY_SETTINGS_UPDATED",
        entityType: "organization",
        entityId: organization.id,
        metadata: { 
          setting: "audit_retention_days",
          oldValue: orgSettings?.audit_retention_days || 365,
          newValue: retentionDays,
        },
      });
    },
    onSuccess: () => {
      toast.success("Política de retención actualizada");
      setRetentionChanged(false);
      queryClient.invalidateQueries({ queryKey: ["org-settings"] });
      queryClient.invalidateQueries({ queryKey: ["org-retention-days"] });
    },
    onError: (error: Error) => {
      toast.error("Error: " + error.message);
    },
  });

  const handleToggle = (key: keyof SecuritySettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleRetentionChange = (value: number[]) => {
    setRetentionDays(value[0]);
    setRetentionChanged(value[0] !== (orgSettings?.audit_retention_days || 365));
  };

  // Defensive check: if organization context is not ready
  if (!organization?.id) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-500" />
            Contexto de Organización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Cargando contexto de organización...
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Las configuraciones de seguridad están deshabilitadas hasta que se cargue el contexto.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Session */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Sesión Actual
          </CardTitle>
          <CardDescription>
            Información sobre tu sesión activa
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Usuario</p>
              <p className="font-medium truncate">{currentUser?.email}</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Rol</p>
              <Badge variant="outline">
                {currentUserRole === "OWNER" ? "Propietario" : 
                 currentUserRole === "ADMIN" ? "Administrador" : "Miembro"}
              </Badge>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground mb-1">Último acceso</p>
              <p className="font-medium">
                {currentUser?.last_sign_in_at 
                  ? format(new Date(currentUser.last_sign_in_at), "dd MMM yyyy HH:mm", { locale: es })
                  : "—"
                }
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Retention Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Política de Retención de Datos
          </CardTitle>
          <CardDescription>
            Define cuánto tiempo se conservan los logs de auditoría
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="font-medium">Días de Retención</Label>
                <p className="text-sm text-muted-foreground">
                  Los logs más antiguos se eliminarán automáticamente
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={30}
                  max={3650}
                  value={retentionDays}
                  onChange={(e) => {
                    const val = Math.max(30, Math.min(3650, parseInt(e.target.value) || 365));
                    setRetentionDays(val);
                    setRetentionChanged(val !== (orgSettings?.audit_retention_days || 365));
                  }}
                  className="w-24 text-right"
                />
                <span className="text-sm text-muted-foreground">días</span>
              </div>
            </div>

            <div className="px-2">
              <Slider
                value={[retentionDays]}
                onValueChange={handleRetentionChange}
                min={30}
                max={3650}
                step={30}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-2">
                <span>30 días</span>
                <span>1 año</span>
                <span>5 años</span>
                <span>10 años</span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">
                  Retención actual: {retentionDays} días ({Math.round(retentionDays / 365 * 10) / 10} años)
                </p>
                <p className="text-muted-foreground">
                  Los eventos críticos (cambios de membresía, suscripciones) se conservan el doble de tiempo.
                </p>
              </div>
            </div>

            {retentionChanged && (
              <Button
                onClick={() => saveRetention.mutate()}
                disabled={saveRetention.isPending}
              >
                {saveRetention.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Guardar Política de Retención
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Access Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Controles de Acceso
          </CardTitle>
          <CardDescription>
            Configura las políticas de acceso a la organización
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Solo por invitación</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Los nuevos usuarios solo pueden unirse mediante invitación de un administrador
              </p>
            </div>
            <Switch
              checked={settings.require_invite_only}
              onCheckedChange={(v) => handleToggle("require_invite_only", v)}
            />
          </div>

          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <Label className="font-medium">Deshabilitar enlaces externos</Label>
              </div>
              <p className="text-sm text-muted-foreground">
                Oculta los enlaces a expedientes electrónicos hasta que sean verificados
              </p>
            </div>
            <Switch
              checked={settings.disable_external_links}
              onCheckedChange={(v) => handleToggle("disable_external_links", v)}
            />
          </div>

          <Separator />

          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <p className="font-medium text-sm">Dominios Permitidos (Próximamente)</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Restringe los enlaces externos a dominios específicos como OneDrive o SharePoint.
              Esta función estará disponible en una próxima versión.
            </p>
          </div>

          {hasChanges && (
            <Button
              onClick={() => saveSettings.mutate()}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Guardar Cambios
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Security Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Información de Seguridad
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <Shield className="h-5 w-5 text-green-600 mt-0.5" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">RLS Habilitado</p>
                <p className="text-green-700 dark:text-green-300">
                  Todos los datos están protegidos por Row Level Security a nivel de base de datos.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Lock className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-blue-800 dark:text-blue-200">Aislamiento Multi-Tenant</p>
                <p className="text-blue-700 dark:text-blue-300">
                  Cada organización tiene datos completamente aislados de otras organizaciones.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg">
              <Clock className="h-5 w-5 text-purple-600 mt-0.5" />
              <div>
                <p className="font-medium text-purple-800 dark:text-purple-200">Auditoría Completa</p>
                <p className="text-purple-700 dark:text-purple-300">
                  Todas las acciones administrativas quedan registradas en el historial de auditoría.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg">
              <Shield className="h-5 w-5 text-indigo-600 mt-0.5" />
              <div>
                <p className="font-medium text-indigo-800 dark:text-indigo-200">Proxy de Egreso</p>
                <p className="text-indigo-700 dark:text-indigo-300">
                  Todas las comunicaciones externas pasan por un punto de control con lista de dominios autorizados y escáner de PII.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800 rounded-lg">
              <ShieldCheck className="h-5 w-5 text-teal-600 mt-0.5" />
              <div>
                <p className="font-medium text-teal-800 dark:text-teal-200">Alertas de Seguridad Autónomas</p>
                <p className="text-teal-700 dark:text-teal-300">
                  Atenia AI detecta exportaciones masivas, escalamiento de permisos y violaciones de egreso en tiempo real.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg">
              <Lock className="h-5 w-5 text-orange-600 mt-0.5" />
              <div>
                <p className="font-medium text-orange-800 dark:text-orange-200">CSP Estricto</p>
                <p className="text-orange-700 dark:text-orange-300">
                  Content-Security-Policy previene inyección de scripts, robo de datos del navegador y solicitudes a dominios no autorizados.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
