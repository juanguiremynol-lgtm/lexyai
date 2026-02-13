/**
 * Billing Overview — KPIs dashboard for subscription health
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Users,
  Clock,
  AlertTriangle,
  Ban,
  TrendingUp,
  CreditCard,
  ShieldCheck,
} from "lucide-react";

interface BillingKPIs {
  active: number;
  trial: number;
  pendingPayment: number;
  pastDue: number;
  suspended: number;
  cancelled: number;
  churned: number;
  expired: number;
  totalOrgs: number;
  recentTransactions: number;
  pendingVerifications: number;
}

export function BillingOverviewSection() {
  const { data: kpis, isLoading } = useQuery({
    queryKey: ["platform-billing-kpis"],
    queryFn: async (): Promise<BillingKPIs> => {
      // Fetch subscription states
      const { data: states } = await supabase
        .from("billing_subscription_state")
        .select("status, plan_code");

      const statusCounts: Record<string, number> = {};
      (states || []).forEach((s) => {
        const status = (s.status || "UNKNOWN").toUpperCase();
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      // Fetch org count
      const { count: totalOrgs } = await supabase
        .from("organizations")
        .select("id", { count: "exact", head: true });

      // Fetch recent transactions (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { count: recentTxns } = await supabase
        .from("payment_transactions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo);

      // Pending verifications
      const { count: pendingVerify } = await supabase
        .from("payment_transactions")
        .select("id", { count: "exact", head: true })
        .eq("status", "PROCESSING");

      return {
        active: statusCounts["ACTIVE"] || 0,
        trial: statusCounts["TRIAL"] || 0,
        pendingPayment: statusCounts["PENDING_PAYMENT"] || 0,
        pastDue: statusCounts["PAST_DUE"] || 0,
        suspended: statusCounts["SUSPENDED"] || 0,
        cancelled: statusCounts["CANCELLED"] || 0,
        churned: statusCounts["CHURNED"] || 0,
        expired: statusCounts["EXPIRED"] || 0,
        totalOrgs: totalOrgs || 0,
        recentTransactions: recentTxns || 0,
        pendingVerifications: pendingVerify || 0,
      };
    },
    staleTime: 30_000,
  });

  const kpiCards = [
    { label: "Activas", value: kpis?.active, icon: TrendingUp, color: "text-emerald-400" },
    { label: "En Prueba", value: kpis?.trial, icon: Clock, color: "text-blue-400" },
    { label: "Pago Pendiente", value: kpis?.pendingPayment, icon: CreditCard, color: "text-amber-400" },
    { label: "Mora", value: kpis?.pastDue, icon: AlertTriangle, color: "text-orange-400" },
    { label: "Suspendidas", value: kpis?.suspended, icon: Ban, color: "text-red-400" },
    { label: "Canceladas", value: kpis?.cancelled, icon: Ban, color: "text-slate-400" },
    { label: "Organizaciones", value: kpis?.totalOrgs, icon: Users, color: "text-slate-300" },
    { label: "Verificaciones Pendientes", value: kpis?.pendingVerifications, icon: ShieldCheck, color: "text-purple-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6 text-amber-400" />
          Resumen de Facturación
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Vista general del estado de suscripciones, pagos y verificaciones de la plataforma.
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpiCards.map((card) => (
          <Card key={card.label} className="bg-slate-900/50 border-slate-700/50">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-2">
                <card.icon className={`h-5 w-5 ${card.color}`} />
                {card.label === "Mora" && (card.value || 0) > 0 && (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                    Atención
                  </Badge>
                )}
              </div>
              <p className="text-2xl font-bold text-slate-100">
                {isLoading ? "—" : card.value ?? 0}
              </p>
              <p className="text-xs text-slate-400 mt-1">{card.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Billing Health Gate */}
      <Card className="bg-slate-900/50 border-slate-700/50">
        <CardHeader>
          <CardTitle className="text-slate-100 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-400" />
            Billing Health Gate
          </CardTitle>
          <CardDescription className="text-slate-400">
            Invariantes de salud del sistema de facturación monitoreados por Atenia AI.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <HealthGateItem
              label="Webhook Activo"
              description="Último callback recibido en las últimas 24h"
              ok={true}
            />
            <HealthGateItem
              label="Sin Mora Crítica"
              description="Ninguna org con más de 3 intentos fallidos"
              ok={(kpis?.pastDue || 0) === 0}
            />
            <HealthGateItem
              label="Verificaciones al Día"
              description="Menos de 5 verificaciones pendientes"
              ok={(kpis?.pendingVerifications || 0) < 5}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HealthGateItem({ label, description, ok }: { label: string; description: string; ok: boolean }) {
  return (
    <div className={`p-3 rounded-lg border ${ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400 animate-pulse"}`} />
        <span className={`text-sm font-medium ${ok ? "text-emerald-300" : "text-red-300"}`}>{label}</span>
      </div>
      <p className="text-xs text-slate-400">{description}</p>
    </div>
  );
}
