/**
 * Billing Settings & Audit Section — Configuration and audit trail
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, History, Shield, Key } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function BillingSettingsSection() {
  // Fetch recent billing audit actions
  const { data: auditActions, isLoading } = useQuery({
    queryKey: ["platform-billing-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atenia_ai_actions")
        .select("*")
        .in("action_type", [
          "VERIFY_PAYMENT",
          "ACTIVATE_PLAN",
          "ADMIN_OVERRIDE",
          "EXTEND_TRIAL",
          "CANCEL_SUBSCRIPTION",
          "SUSPEND_SUBSCRIPTION",
          "REFUND_PROPOSED",
        ])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Settings className="h-6 w-6 text-amber-400" />
          Configuración y Auditoría
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Ajustes de facturación, secretos del gateway y trail de auditoría completo.
        </p>
      </div>

      {/* Gateway Secrets Status */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <Key className="h-4 w-4 text-amber-400" />
            Secretos del Gateway
          </CardTitle>
          <CardDescription className="text-slate-400">
            Las claves de la pasarela se almacenan exclusivamente como secretos del entorno.
            Nunca se muestran ni se guardan en la base de datos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SecretRow label="WOMPI_PUBLIC_KEY" configured={false} />
          <SecretRow label="WOMPI_PRIVATE_KEY" configured={false} />
          <SecretRow label="WOMPI_WEBHOOK_SECRET" configured={false} />
          <SecretRow label="WOMPI_ENVIRONMENT" configured={false} />
          <p className="text-xs text-slate-500 mt-3">
            Para configurar estos secretos, use la herramienta de secretos del proyecto.
            Los valores nunca se muestran una vez configurados.
          </p>
        </CardContent>
      </Card>

      {/* Audit Policy */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-400" />
            Política de Auditoría
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-slate-300">
          <p>• Toda acción administrativa genera un registro en <code className="text-amber-300">atenia_ai_actions</code> con actor, razón y evidencia.</p>
          <p>• Cada cambio de estado de suscripción crea una entrada inmutable en <code className="text-amber-300">subscription_events</code>.</p>
          <p>• Las anulaciones manuales (ADMIN_OVERRIDE) requieren justificación obligatoria y quedan marcadas explícitamente.</p>
          <p>• Todos los payloads almacenados pasan por <code className="text-amber-300">redactSecrets()</code> antes de persistirse.</p>
        </CardContent>
      </Card>

      {/* Audit Trail */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <History className="h-4 w-4 text-amber-400" />
            Trail de Auditoría — Facturación
          </CardTitle>
          <CardDescription className="text-slate-400">
            Últimas 50 acciones de facturación registradas en atenia_ai_actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (auditActions?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay acciones de facturación registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Acción</th>
                    <th className="text-left py-2 px-2">Actor</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Razonamiento</th>
                  </tr>
                </thead>
                <tbody>
                  {auditActions?.map((a) => (
                    <tr key={a.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300">
                        {a.created_at ? format(new Date(a.created_at), "dd MMM HH:mm", { locale: es }) : "—"}
                      </td>
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-xs">{a.action_type}</Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400">{a.actor || "SYSTEM"}</td>
                      <td className="py-2 px-2">
                        <Badge
                          className={
                            a.status === "EXECUTED"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : a.status === "FAILED"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-slate-500/20 text-slate-300 border-slate-500/30"
                          }
                        >
                          {a.status || "—"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400 max-w-xs truncate">{a.reasoning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SecretRow({ label, configured }: { label: string; configured: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-sm text-slate-300">{label}</span>
      <Badge className={configured
        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
        : "bg-slate-500/20 text-slate-400 border-slate-500/30"
      }>
        {configured ? "Configurado" : "No configurado"}
      </Badge>
    </div>
  );
}
