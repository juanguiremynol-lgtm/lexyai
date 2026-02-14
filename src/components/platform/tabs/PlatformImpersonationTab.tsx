/**
 * Platform Support Tab - Consent-based support access
 * 
 * Super admins can only access user data through:
 * 1. Redacted support info (default, always available for diagnostics)
 * 2. Direct view (requires explicit user authorization via Atenia AI, 30 min max)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Eye, 
  EyeOff,
  Building2,
  Users,
  Shield,
  ShieldAlert,
  Search,
  LogIn,
  LogOut,
  Clock,
  Lock,
  Bot,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface ActiveGrant {
  id: string;
  user_id: string;
  organization_id: string;
  access_type: string;
  redaction_level: string;
  reason: string | null;
  granted_at: string;
  expires_at: string;
  status: string;
}

export function PlatformImpersonationTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const { isImpersonating, impersonatedOrg, enterImpersonation, exitImpersonation } = useImpersonation();

  // Fetch only grants given TO this admin
  const { data: activeGrants, isLoading: grantsLoading } = useQuery({
    queryKey: ["platform-support-grants"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("support_access_grants")
        .select("id, user_id, organization_id, access_type, redaction_level, reason, granted_at, expires_at, status")
        .eq("granted_to_admin_id", user.id)
        .eq("status", "ACTIVE")
        .gt("expires_at", new Date().toISOString())
        .order("granted_at", { ascending: false });

      if (error) {
        console.warn("[PlatformImpersonationTab] Error fetching grants:", error.message);
        return [];
      }
      return (data || []) as ActiveGrant[];
    },
    refetchInterval: 30_000, // Refresh every 30s to catch expirations
  });

  // Fetch org names for grants
  const grantOrgIds = [...new Set(activeGrants?.map(g => g.organization_id) || [])];
  const { data: grantOrgs } = useQuery({
    queryKey: ["grant-org-names", grantOrgIds],
    queryFn: async () => {
      if (grantOrgIds.length === 0) return new Map<string, string>();
      const { data } = await supabase
        .from("organizations")
        .select("id, name")
        .in("id", grantOrgIds);
      return new Map((data || []).map(o => [o.id, o.name]));
    },
    enabled: grantOrgIds.length > 0,
  });

  // Recent grant history (expired/revoked)
  const { data: grantHistory } = useQuery({
    queryKey: ["platform-support-grant-history"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("support_access_grants")
        .select("id, organization_id, access_type, reason, granted_at, expires_at, status")
        .eq("granted_to_admin_id", user.id)
        .neq("status", "ACTIVE")
        .order("granted_at", { ascending: false })
        .limit(20);

      if (error) return [];
      return data || [];
    },
  });

  const getAccessBadge = (type: string) => {
    if (type === "DIRECT_VIEW") {
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Vista Directa</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Redactado</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Privacy-First Warning */}
      <Alert className="border-primary/50 bg-primary/5">
        <Shield className="h-4 w-4 text-primary" />
        <AlertTitle>Soporte basado en Consentimiento</AlertTitle>
        <AlertDescription>
          No tiene acceso directo a datos de usuarios ni organizaciones. 
          El soporte se canaliza exclusivamente a través de <strong>Andro IA</strong>, que le proporcionará 
          información <strong>redactada</strong> para diagnósticos. Para vista directa ("lo que el usuario ve"), 
          el usuario debe autorizar explícitamente un acceso temporal de máximo 30 minutos.
        </AlertDescription>
      </Alert>

      {/* Active Impersonation Session */}
      {isImpersonating && impersonatedOrg && (
        <Card className="border-primary">
          <CardHeader className="bg-primary/5">
            <CardTitle className="flex items-center gap-2 text-primary">
              <Eye className="h-5 w-5" />
              Sesión de Soporte Activa (Autorizada)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium">{impersonatedOrg.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Modo solo lectura — Autorizado por el usuario
                  </p>
                </div>
              </div>
              <Button
                variant="destructive"
                onClick={exitImpersonation}
                className="gap-2"
              >
                <LogOut className="h-4 w-4" />
                Salir
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Grants (User-Authorized) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Accesos Autorizados por Usuarios
            {(activeGrants?.length || 0) > 0 && (
              <Badge variant="default" className="ml-2">{activeGrants?.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Usuarios que le han otorgado acceso temporal de soporte a través de Andro IA
          </CardDescription>
        </CardHeader>
        <CardContent>
          {grantsLoading ? (
            <p className="text-center text-muted-foreground py-6">Cargando...</p>
          ) : (activeGrants?.length || 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <EyeOff className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">No hay accesos autorizados activos</p>
              <p className="text-sm text-muted-foreground mt-1">
                Cuando un usuario autorice soporte a través de Andro IA, aparecerá aquí.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeGrants?.map((grant) => (
                <div
                  key={grant.id}
                  className="p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {grantOrgs?.get(grant.organization_id) || "Organización"}
                        </span>
                        {getAccessBadge(grant.access_type)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {grant.reason || "Soporte técnico"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expira {formatDistanceToNow(new Date(grant.expires_at), { addSuffix: true, locale: es })}
                        </span>
                      </div>
                    </div>
                    {grant.access_type === "DIRECT_VIEW" && !isImpersonating && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => enterImpersonation({
                          id: grant.organization_id,
                          name: grantOrgs?.get(grant.organization_id) || "Organización",
                        })}
                        className="gap-2 shrink-0"
                      >
                        <LogIn className="h-4 w-4" />
                        Ver como usuario
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How Support Works */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Flujo de Soporte
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border bg-muted/30">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <EyeOff className="h-4 w-4" />
                Soporte Redactado (Predeterminado)
              </h4>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li>Usuario reporta problema a Andro IA</li>
                <li>Andro IA recopila diagnósticos técnicos</li>
                <li>Usted recibe info <strong>redactada</strong> (sin nombres, correos ni datos de clientes)</li>
                <li>Resuelve el problema sin ver datos personales</li>
              </ol>
            </div>
            <div className="p-4 rounded-lg border bg-muted/30">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Vista Directa (Requiere Autorización)
              </h4>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                <li>Si el soporte redactado no basta, solicite vista directa</li>
                <li>Andro IA pregunta al usuario: "¿Autoriza acceso directo por 30 min?"</li>
                <li>El usuario confirma explícitamente</li>
                <li>Usted obtiene acceso temporal de solo lectura</li>
                <li>El usuario puede revocar en cualquier momento</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grant History */}
      {(grantHistory?.length || 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Historial de Accesos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {grantHistory?.map((g: any) => (
                <div key={g.id} className="p-2 border rounded flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    {getAccessBadge(g.access_type)}
                    <Badge variant="outline" className="text-muted-foreground">{g.status}</Badge>
                    <span className="text-muted-foreground">{g.reason || "Soporte"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(g.granted_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
