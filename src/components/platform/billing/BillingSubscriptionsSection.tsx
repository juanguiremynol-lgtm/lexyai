/**
 * Billing Subscriptions Section — Search, view, and manage subscription lifecycle
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Crown,
  Search,
  Play,
  Pause,
  XCircle,
  RefreshCw,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

function formatCOP(amount: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

const statusLabels: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Activa", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  TRIAL: { label: "Prueba", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  PENDING_PAYMENT: { label: "Pago Pendiente", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  PAST_DUE: { label: "En Mora", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  SUSPENDED: { label: "Suspendida", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  CANCELLED: { label: "Cancelada", className: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  CHURNED: { label: "Churned", className: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  EXPIRED: { label: "Expirada", className: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
};

export function BillingSubscriptionsSection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");

  // Fetch subscription states with org info
  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["platform-billing-subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("billing_subscription_state")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const { data: orgs } = await supabase.from("organizations").select("id, name");
      const orgMap = new Map((orgs || []).map((o) => [o.id, o.name]));

      return (data || []).map((s) => ({
        ...s,
        org_name: orgMap.get(s.organization_id) || "Desconocida",
      }));
    },
    staleTime: 30_000,
  });

  // Fetch events for selected org
  const { data: events } = useQuery({
    queryKey: ["platform-subscription-events", selectedOrgId],
    queryFn: async () => {
      if (!selectedOrgId) return [];
      const { data, error } = await supabase
        .from("subscription_events")
        .select("*")
        .eq("organization_id", selectedOrgId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedOrgId,
  });

  // Admin force re-verify
  const forceReVerify = useMutation({
    mutationFn: async (orgId: string) => {
      const { data: txns } = await supabase
        .from("payment_transactions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("status", "PROCESSING")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!txns?.length) throw new Error("No hay transacciones pendientes de verificación");

      const { data, error } = await supabase.functions.invoke("atenia-ai-verify-payment", {
        body: { transaction_id: txns[0].id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["platform-billing-subscriptions"] });
      toast.success("Re-verificación ejecutada", { description: JSON.stringify(data?.status || data?.ok) });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = subscriptions?.filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.org_name.toLowerCase().includes(q) ||
      s.organization_id.toLowerCase().includes(q) ||
      s.plan_code.toLowerCase().includes(q)
    );
  });

  const selected = selectedOrgId ? subscriptions?.find((s) => s.organization_id === selectedOrgId) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Crown className="h-6 w-6 text-amber-400" />
          Suscripciones
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Buscar, inspeccionar y operar sobre el ciclo de vida de suscripciones.
        </p>
      </div>

      {/* Search */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por organización, ID, o plan..."
            className="pl-10"
          />
        </div>
      </div>

      {/* Subscriptions List */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardContent className="pt-4">
          {isLoading ? (
            <p className="text-sm text-slate-400">Cargando...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700/50">
                    <th className="text-left py-2 px-2">Organización</th>
                    <th className="text-left py-2 px-2">Plan</th>
                    <th className="text-left py-2 px-2">Estado</th>
                    <th className="text-left py-2 px-2">Precio COP</th>
                    <th className="text-left py-2 px-2">Próximo Cobro</th>
                    <th className="text-left py-2 px-2">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered?.map((s) => {
                    const st = statusLabels[(s.status || "").toUpperCase()] || { label: s.status || "—", className: "bg-slate-500/20 text-slate-300" };
                    return (
                      <tr
                        key={s.organization_id}
                        className={`border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer ${selectedOrgId === s.organization_id ? "bg-amber-500/5" : ""}`}
                        onClick={() => setSelectedOrgId(s.organization_id)}
                      >
                        <td className="py-2 px-2 text-slate-200">{s.org_name}</td>
                        <td className="py-2 px-2">
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{s.plan_code}</Badge>
                        </td>
                        <td className="py-2 px-2"><Badge className={st.className}>{st.label}</Badge></td>
                        <td className="py-2 px-2 text-slate-300">{formatCOP(s.current_price_cop_incl_iva)}</td>
                        <td className="py-2 px-2 text-slate-400">
                          {s.next_billing_at ? format(new Date(s.next_billing_at), "dd MMM yyyy", { locale: es }) : "—"}
                        </td>
                        <td className="py-2 px-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={(e) => { e.stopPropagation(); forceReVerify.mutate(s.organization_id); }}
                            disabled={forceReVerify.isPending}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" />
                            Re-verificar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Timeline for Selected Org */}
      {selected && (
        <Card className="bg-slate-900/50 border-slate-700/50">
          <CardHeader>
            <CardTitle className="text-slate-100 text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              Línea de Tiempo — {selected.org_name}
            </CardTitle>
            <CardDescription className="text-slate-400">
              Eventos inmutables de suscripción (subscription_events).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(events?.length || 0) === 0 ? (
              <p className="text-sm text-slate-500">Sin eventos registrados.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {events?.map((e: any) => (
                  <div key={e.id} className="flex gap-3 p-2 rounded-lg bg-slate-800/30 border border-slate-700/20">
                    <div className="h-2 w-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">{e.event_type}</Badge>
                        <span className="text-xs text-slate-500">
                          {format(new Date(e.created_at), "dd MMM HH:mm", { locale: es })}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 mt-1">{e.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
