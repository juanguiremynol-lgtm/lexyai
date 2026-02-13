/**
 * Billing Transactions Section — View payment transactions and invoices
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

const txnStatusStyle: Record<string, string> = {
  COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  PROCESSING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  FAILED: "bg-red-500/20 text-red-400 border-red-500/30",
  REFUNDED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

export function BillingTransactionsSection() {
  const { data: transactions, isLoading } = useQuery({
    queryKey: ["platform-payment-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const orgIds = [...new Set((data || []).map((t) => t.organization_id))];
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds);
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      return (data || []).map((t) => ({
        ...t,
        org_name: orgMap.get(t.organization_id) || "—",
      }));
    },
    staleTime: 15_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Receipt className="h-6 w-6 text-amber-400" />
          Transacciones
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Registro de pagos recibidos, verificaciones y estados de transacción.
        </p>
      </div>

      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando transacciones...</p>
          ) : (transactions?.length || 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay transacciones registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Fecha</th>
                    <th className="text-left py-2 px-2">Organización</th>
                    <th className="text-left py-2 px-2">Plan</th>
                    <th className="text-left py-2 px-2">Monto</th>
                    <th className="text-left py-2 px-2">Gateway</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Verificación</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions?.map((t: any) => (
                    <tr key={t.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300">
                        {format(new Date(t.created_at), "dd MMM HH:mm", { locale: es })}
                      </td>
                      <td className="py-2 px-2 text-slate-200">{t.org_name}</td>
                      <td className="py-2 px-2"><Badge variant="outline">{t.plan_code}</Badge></td>
                      <td className="py-2 px-2 text-slate-200 font-medium">{formatCOP(t.amount_cop)}</td>
                      <td className="py-2 px-2 text-slate-400">{t.gateway}</td>
                      <td className="py-2 px-2">
                        <Badge className={txnStatusStyle[t.status] || "bg-slate-500/20 text-slate-300"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-slate-400">
                        {t.verified_at
                          ? format(new Date(t.verified_at), "HH:mm", { locale: es })
                          : t.status === "PROCESSING" ? "Pendiente" : "—"}
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
