/**
 * Billing Fraud & Verification Section — AI verification results, fraud signals
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export function BillingFraudSection() {
  // Fetch AI verification actions
  const { data: verifications, isLoading } = useQuery({
    queryKey: ["platform-billing-verifications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("atenia_ai_actions")
        .select("*")
        .eq("action_type", "VERIFY_PAYMENT")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    staleTime: 15_000,
  });

  // Fetch failed/suspicious transactions
  const { data: suspiciousTxns } = useQuery({
    queryKey: ["platform-suspicious-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .in("status", ["FAILED", "FRAUD_SUSPECTED"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;

      const orgIds = [...new Set((data || []).map((t) => t.organization_id))];
      if (orgIds.length === 0) return [];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      return (data || []).map((t) => ({ ...t, org_name: orgMap.get(t.organization_id) || "—" }));
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-amber-400" />
          Fraude y Verificación
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Resultados de verificación por Atenia AI, señales de fraude y transacciones sospechosas.
        </p>
      </div>

      {/* Verification Results */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            Verificaciones de Atenia AI
          </CardTitle>
          <CardDescription className="text-slate-400">
            Cada pago pasa por verificación automática antes de activar el plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (verifications?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay verificaciones registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Organización</th>
                    <th className="text-left py-2 px-2">Resultado</th>
                    <th className="text-left py-2 px-2">Razonamiento</th>
                  </tr>
                </thead>
                <tbody>
                  {verifications?.map((v) => (
                    <tr key={v.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300">
                        {v.created_at ? format(new Date(v.created_at), "dd MMM HH:mm", { locale: es }) : "—"}
                      </td>
                      <td className="py-2 px-2 text-slate-200 font-mono text-xs">
                        {v.organization_id.slice(0, 8)}...
                      </td>
                      <td className="py-2 px-2">
                        <Badge
                          className={
                            v.action_result === "APPROVED" || v.action_result === "applied"
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : v.action_result === "REJECTED"
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                          }
                        >
                          {v.action_result || "—"}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400 max-w-xs truncate">{v.reasoning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suspicious Transactions */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            Transacciones Sospechosas
          </CardTitle>
          <CardDescription className="text-slate-400">
            Transacciones fallidas o marcadas como sospechosas por el sistema de verificación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(suspiciousTxns?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay transacciones sospechosas.</p>
          ) : (
            <div className="space-y-2">
              {suspiciousTxns?.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                  <div>
                    <p className="text-sm text-slate-200">{t.org_name} — {t.plan_code}</p>
                    <p className="text-xs text-slate-400">
                      {format(new Date(t.created_at), "dd MMM HH:mm", { locale: es })} · Gateway: {t.gateway}
                    </p>
                  </div>
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{t.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
