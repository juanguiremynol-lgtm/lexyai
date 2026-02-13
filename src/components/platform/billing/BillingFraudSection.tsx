/**
 * Billing Fraud & Verification Section — AI verification results, fraud signals, risk dashboard
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

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

  // Compute risk stats
  const totalVerifications = verifications?.length || 0;
  const approvedCount = verifications?.filter(v => v.action_result === "APPROVED" || v.action_result === "applied").length || 0;
  const rejectedCount = verifications?.filter(v => v.action_result === "REJECTED").length || 0;
  const pendingCount = totalVerifications - approvedCount - rejectedCount;
  const approvalRate = totalVerifications > 0 ? Math.round((approvedCount / totalVerifications) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <ShieldAlert className="h-6 w-6 text-amber-400" />
          Fraude y Verificación
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Resultados de verificación por Atenia AI, señales de fraude y dashboard de riesgo.
        </p>
      </div>

      {/* Risk KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          label="Verificaciones"
          value={totalVerifications.toString()}
          icon={<Activity className="h-4 w-4 text-amber-400" />}
          sub="Últimas 50"
        />
        <KPICard
          label="Aprobadas"
          value={`${approvalRate}%`}
          icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}
          sub={`${approvedCount} de ${totalVerifications}`}
          accent="emerald"
        />
        <KPICard
          label="Rechazadas"
          value={rejectedCount.toString()}
          icon={<ShieldAlert className="h-4 w-4 text-red-400" />}
          sub={rejectedCount > 0 ? "Requiere revisión" : "Sin incidentes"}
          accent={rejectedCount > 0 ? "red" : undefined}
        />
        <KPICard
          label="Sospechosas"
          value={(suspiciousTxns?.length || 0).toString()}
          icon={<AlertTriangle className="h-4 w-4 text-orange-400" />}
          sub="Txns fallidas/sospechosas"
          accent={(suspiciousTxns?.length || 0) > 0 ? "orange" : undefined}
        />
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
                    <th className="text-left py-2 px-2">Tier</th>
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
                      <td className="py-2 px-2">
                        <Badge variant="outline" className="text-xs">{v.autonomy_tier}</Badge>
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
                      {format(new Date(t.created_at), "dd MMM HH:mm", { locale: es })} · {formatCOP(t.amount_cop)} · Gateway: {t.gateway}
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

function KPICard({ label, value, icon, sub, accent }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  sub: string;
  accent?: "emerald" | "red" | "orange";
}) {
  const borderClass = accent === "emerald" ? "border-emerald-500/20"
    : accent === "red" ? "border-red-500/20"
    : accent === "orange" ? "border-orange-500/20"
    : "border-slate-700/50";

  return (
    <Card className={`bg-slate-900/50 ${borderClass}`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <span className="text-xs text-slate-400">{label}</span>
        </div>
        <p className="text-2xl font-bold text-slate-100">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
