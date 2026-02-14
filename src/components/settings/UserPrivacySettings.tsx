/**
 * UserPrivacySettings — Privacy & Support Access controls for all users.
 * 
 * Shows:
 * - Privacy policy summary (what super admins can/cannot see)
 * - Active support access grants
 * - Support access history
 * - Controls to revoke active grants
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Shield,
  ShieldCheck,
  Eye,
  EyeOff,
  Clock,
  XCircle,
  Lock,
  Bot,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface SupportGrant {
  id: string;
  access_type: string;
  scope: string;
  redaction_level: string;
  reason: string | null;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  status: string;
}

export function UserPrivacySettings() {
  const queryClient = useQueryClient();

  // Fetch active + recent grants
  const { data: grants, isLoading } = useQuery({
    queryKey: ["support-access-grants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_access_grants")
        .select("id, access_type, scope, redaction_level, reason, granted_at, expires_at, revoked_at, status")
        .order("granted_at", { ascending: false })
        .limit(20);

      if (error) throw error;

      // Auto-expire active grants past their expiry in the UI
      return (data || []).map((g: any) => ({
        ...g,
        status: g.status === "ACTIVE" && new Date(g.expires_at) < new Date() ? "EXPIRED" : g.status,
      })) as SupportGrant[];
    },
    refetchInterval: 30_000,
  });

  const activeGrants = grants?.filter((g) => g.status === "ACTIVE" && new Date(g.expires_at) > new Date()) || [];
  const pastGrants = grants?.filter((g) => g.status !== "ACTIVE" || new Date(g.expires_at) <= new Date()) || [];

  // Revoke grant
  const revokeGrant = useMutation({
    mutationFn: async (grantId: string) => {
      const { error } = await supabase
        .from("support_access_grants")
        .update({
          status: "REVOKED",
          revoked_at: new Date().toISOString(),
        })
        .eq("id", grantId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-access-grants"] });
      toast.success("Acceso de soporte revocado inmediatamente");
    },
    onError: (error: Error) => {
      toast.error("Error al revocar: " + error.message);
    },
  });

  const getAccessTypeBadge = (type: string) => {
    if (type === "DIRECT_VIEW") {
      return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Vista directa</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Redactado</Badge>;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Activo</Badge>;
      case "EXPIRED":
        return <Badge variant="outline" className="text-muted-foreground">Expirado</Badge>;
      case "REVOKED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Revocado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Privacy Policy Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Política de Privacidad y Soporte
          </CardTitle>
          <CardDescription>
            Cómo se protegen sus datos frente a terceros y administradores de plataforma
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* What super admin CANNOT do */}
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 mb-3">
                <EyeOff className="h-5 w-5 text-green-600" />
                <h4 className="font-medium text-green-800 dark:text-green-200">
                  Protección Garantizada
                </h4>
              </div>
              <ul className="space-y-2 text-sm text-green-700 dark:text-green-300">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Los administradores de plataforma <strong>NO pueden ver</strong> información personal, datos de clientes, ni actuaciones</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Toda información de soporte se entrega <strong>redactada</strong> (nombres, radicados y datos sensibles ocultos)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>El cifrado AES-256-GCM protege el 100% de campos sensibles</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Los miembros de organización solo ven su propia información personal</span>
                </li>
              </ul>
            </div>

            {/* What requires authorization */}
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-3">
                <Eye className="h-5 w-5 text-amber-600" />
                <h4 className="font-medium text-amber-800 dark:text-amber-200">
                  Acceso Condicional (Requiere su Autorización)
                </h4>
              </div>
              <ul className="space-y-2 text-sm text-amber-700 dark:text-amber-300">
                <li className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Vista directa "lo que yo veo" solo se activa <strong>con su permiso explícito</strong> a través de Andro IA</span>
                </li>
                <li className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Máximo <strong>30 minutos</strong> de acceso temporal</span>
                </li>
                <li className="flex items-start gap-2">
                  <Lock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Puede <strong>revocar</strong> en cualquier momento desde aquí</span>
                </li>
                <li className="flex items-start gap-2">
                  <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>Cada acceso queda registrado en auditoría inmutable</span>
                </li>
              </ul>
            </div>
          </div>

          <Alert className="border-primary/30 bg-primary/5">
            <Bot className="h-4 w-4 text-primary" />
            <AlertTitle>Soporte a través de Andro IA</AlertTitle>
            <AlertDescription className="text-sm">
              Todas las solicitudes de soporte se canalizan exclusivamente a través de Andro IA (el asistente robot).
              Para solicitar soporte, hable con Andro IA y diga algo como "necesito ayuda con..." o "tengo un problema con...".
              Andro IA le pedirá su autorización explícita antes de compartir cualquier información con el equipo de soporte.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Active Support Grants */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Accesos de Soporte Activos
            {activeGrants.length > 0 && (
              <Badge variant="destructive" className="ml-2">{activeGrants.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Permisos de soporte temporales que usted ha autorizado
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activeGrants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldCheck className="h-10 w-10 text-green-500 mb-3" />
              <p className="font-medium text-green-700 dark:text-green-300">
                No hay accesos de soporte activos
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Su información está completamente privada.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeGrants.map((grant) => (
                <div
                  key={grant.id}
                  className="p-4 border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50/50 dark:bg-amber-950/30"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {getAccessTypeBadge(grant.access_type)}
                        {getStatusBadge(grant.status)}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {grant.reason || "Soporte técnico"}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expira {formatDistanceToNow(new Date(grant.expires_at), { addSuffix: true, locale: es })}
                        </span>
                        <span>
                          Otorgado: {format(new Date(grant.granted_at), "dd MMM HH:mm", { locale: es })}
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revokeGrant.mutate(grant.id)}
                      disabled={revokeGrant.isPending}
                      className="gap-1 shrink-0"
                    >
                      <XCircle className="h-4 w-4" />
                      Revocar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {pastGrants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Historial de Accesos
            </CardTitle>
            <CardDescription>
              Registro de accesos de soporte anteriores
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pastGrants.map((grant) => (
                <div
                  key={grant.id}
                  className="p-3 border rounded-lg flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    {getAccessTypeBadge(grant.access_type)}
                    {getStatusBadge(grant.status)}
                    <span className="text-muted-foreground">
                      {grant.reason || "Soporte técnico"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(grant.granted_at), "dd MMM yyyy HH:mm", { locale: es })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Visibility Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Niveles de Visibilidad de Datos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg border bg-muted/30">
                <h4 className="font-medium mb-2">Usted (Miembro)</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>✅ Sus procesos y actuaciones</li>
                  <li>✅ Su perfil personal</li>
                  <li>✅ Suscripción (lectura)</li>
                  <li>❌ Info de otros miembros</li>
                  <li>❌ Logs de auditoría</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border bg-muted/30">
                <h4 className="font-medium mb-2">Admin de Organización</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>✅ Todos los procesos de la org</li>
                  <li>✅ Lista de miembros y roles</li>
                  <li>✅ Facturación completa</li>
                  <li>✅ Logs de auditoría de la org</li>
                  <li>❌ Datos de otras organizaciones</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border bg-muted/30">
                <h4 className="font-medium mb-2">Soporte (Super Admin)</h4>
                <ul className="space-y-1 text-muted-foreground">
                  <li>✅ Estado de suscripción (redactado)</li>
                  <li>✅ Diagnósticos técnicos</li>
                  <li>❌ Datos de clientes/procesos</li>
                  <li>❌ Información personal</li>
                  <li>⚠️ Vista directa solo con su permiso (30 min máx)</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
