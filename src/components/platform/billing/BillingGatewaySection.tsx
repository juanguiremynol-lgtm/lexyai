/**
 * Billing Gateway Section — Wompi configuration and webhook status
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CreditCard,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Shield,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

export function BillingGatewaySection() {
  // Fetch recent webhook receipts
  const { data: webhookReceipts, isLoading, refetch } = useQuery({
    queryKey: ["platform-webhook-receipts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_webhook_receipts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });

  const handleTestWebhook = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("billing-webhook", {
        body: {
          organization_id: "00000000-0000-0000-0000-000000000000",
          checkout_session_id: null,
          plan_code: "BASIC",
          amount_cop: 99000,
          billing_cycle_months: 1,
          status: "APPROVED",
        },
      });
      if (error) throw error;
      toast.success("Webhook de prueba enviado", { description: `Transaction: ${data?.transaction_id}` });
      refetch();
    } catch (err: unknown) {
      toast.error("Error en webhook de prueba", { description: String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-amber-400" />
          Pasarela de Pagos (Wompi)
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Configuración del gateway, estado de webhooks y pruebas de conectividad.
        </p>
      </div>

      {/* Gateway Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-slate-100 text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              Configuración del Gateway
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ConfigRow label="Ambiente" value="Mock (Desarrollo)" status="info" />
            <ConfigRow label="API Key Pública" value="Configurada" status="ok" />
            <ConfigRow label="Webhook Secret" value="Configurado (env)" status="ok" />
            <ConfigRow label="Webhook URL" value="/functions/v1/billing-webhook" status="ok" />
            <p className="text-xs text-slate-500 mt-2">
              Las claves viven exclusivamente en secretos del entorno. Nunca se almacenan en la base de datos.
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-slate-100 text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-amber-400" />
              Pruebas
            </CardTitle>
            <CardDescription className="text-slate-400">
              Enviar webhook simulado o crear sesión de checkout de prueba.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={handleTestWebhook} variant="outline" className="w-full gap-2">
              <ExternalLink className="h-4 w-4" />
              Enviar Webhook de Prueba
            </Button>
            <p className="text-xs text-slate-500">
              Usa una organización mock. El resultado aparecerá en la tabla de callbacks.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Webhook Receipts */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base">
            Callbacks Recientes
          </CardTitle>
          <CardDescription className="text-slate-400">
            Últimos webhooks recibidos. Los payloads son redactados automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (webhookReceipts?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay callbacks registrados aún.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Gateway</th>
                    <th className="text-left py-2 px-2">Evento</th>
                    <th className="text-left py-2 px-2">Txn ID</th>
                    <th className="text-left py-2 px-2">Firma</th>
                    <th className="text-left py-2 px-2">Latencia</th>
                    <th className="text-left py-2 px-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {webhookReceipts?.map((r) => (
                    <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300">
                        {format(new Date(r.created_at), "dd MMM HH:mm", { locale: es })}
                      </td>
                      <td className="py-2 px-2 text-slate-300">{r.gateway}</td>
                      <td className="py-2 px-2 text-slate-300">{r.event_type || "—"}</td>
                      <td className="py-2 px-2 font-mono text-xs text-slate-400">
                        {r.gateway_transaction_id ? r.gateway_transaction_id.slice(0, 12) + "..." : "—"}
                      </td>
                      <td className="py-2 px-2">
                        {r.signature_valid === true ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400" />
                        ) : r.signature_valid === false ? (
                          <XCircle className="h-4 w-4 text-red-400" />
                        ) : (
                          <Clock className="h-4 w-4 text-slate-500" />
                        )}
                      </td>
                      <td className="py-2 px-2 text-slate-400">{r.latency_ms ? `${r.latency_ms}ms` : "—"}</td>
                      <td className="py-2 px-2">
                        <Badge
                          className={
                            r.outcome === "SUCCESS"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : r.outcome === "FAILED"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-slate-500/20 text-slate-300 border-slate-500/30"
                          }
                        >
                          {r.outcome}
                        </Badge>
                      </td>
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

function ConfigRow({ label, value, status }: { label: string; value: string; status: "ok" | "error" | "info" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-slate-200">{value}</span>
        {status === "ok" && <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />}
        {status === "error" && <XCircle className="h-3.5 w-3.5 text-red-400" />}
      </div>
    </div>
  );
}
