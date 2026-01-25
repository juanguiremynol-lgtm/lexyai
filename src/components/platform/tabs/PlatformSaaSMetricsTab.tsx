/**
 * Platform SaaS Metrics Tab - Conversion, Churn, MRR, Cohorts
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Users,
  Calendar,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { format, subMonths, startOfMonth, endOfMonth, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";

// Fallback pricing if DB config not available
const FALLBACK_PRICING: Record<string, number> = {
  FREE_TRIAL: 0,
  BASIC: 49,
  PRO: 149,
  ENTERPRISE: 499,
};

export function PlatformSaaSMetricsTab() {
  const [periodMonths, setPeriodMonths] = useState(3);

  // Fetch all organizations with subscription data
  const { data: metricsData, isLoading } = useQuery({
    queryKey: ["platform-saas-metrics", periodMonths],
    queryFn: async () => {
      const now = new Date();
      const periodStart = startOfMonth(subMonths(now, periodMonths));

      // Get all organizations with created_at
      const { data: orgs, error: orgsError } = await supabase
        .from("organizations")
        .select("id, name, created_at");

      if (orgsError) throw orgsError;

      // Get all subscriptions with history
      const { data: subs, error: subsError } = await supabase
        .from("subscriptions")
        .select("id, organization_id, status, tier, trial_started_at, trial_ends_at, current_period_start, created_at");

      if (subsError) throw subsError;

      // Get MRR pricing config
      const { data: pricingConfig } = await supabase
        .from("mrr_pricing_config")
        .select("tier, monthly_price_usd");

      const pricing: Record<string, number> = {};
      pricingConfig?.forEach((p) => {
        pricing[p.tier] = Number(p.monthly_price_usd);
      });

      // Calculate metrics
      const subsByOrg = new Map(subs?.map((s) => [s.organization_id, s]));

      // Trial to Paid conversion
      const trialOrgs = orgs?.filter((o) => {
        const sub = subsByOrg.get(o.id);
        return sub?.trial_started_at;
      }) || [];

      const convertedOrgs = trialOrgs.filter((o) => {
        const sub = subsByOrg.get(o.id);
        return sub?.status === "active";
      });

      const conversionRate = trialOrgs.length > 0 
        ? (convertedOrgs.length / trialOrgs.length) * 100 
        : 0;

      // Churn (active -> suspended/expired in period)
      const activeOrgs = orgs?.filter((o) => {
        const sub = subsByOrg.get(o.id);
        return sub?.status === "active";
      }) || [];

      const churnedOrgs = orgs?.filter((o) => {
        const sub = subsByOrg.get(o.id);
        const orgDate = new Date(o.created_at);
        return (
          (sub?.status === "past_due" || sub?.status === "expired") &&
          orgDate >= periodStart
        );
      }) || [];

      const churnRate = activeOrgs.length > 0 
        ? (churnedOrgs.length / activeOrgs.length) * 100 
        : 0;

      // MRR calculation
      let estimatedMRR = 0;
      subs?.forEach((sub) => {
        if (sub.status === "active") {
          const tierPrice = pricing[sub.tier || "FREE_TRIAL"] ?? FALLBACK_PRICING[sub.tier || "FREE_TRIAL"] ?? 0;
          estimatedMRR += tierPrice;
        }
      });

      // Cohort analysis by signup month
      const cohorts: Record<string, { total: number; trialing: number; active: number; churned: number }> = {};
      
      orgs?.forEach((org) => {
        const monthKey = format(new Date(org.created_at), "yyyy-MM");
        if (!cohorts[monthKey]) {
          cohorts[monthKey] = { total: 0, trialing: 0, active: 0, churned: 0 };
        }
        cohorts[monthKey].total++;

        const sub = subsByOrg.get(org.id);
        if (sub?.status === "trialing") cohorts[monthKey].trialing++;
        else if (sub?.status === "active") cohorts[monthKey].active++;
        else if (sub?.status === "past_due" || sub?.status === "expired") cohorts[monthKey].churned++;
      });

      // Sort cohorts by date descending
      const sortedCohorts = Object.entries(cohorts)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 6);

      // Summary stats
      const totalOrgs = orgs?.length || 0;
      const trialingCount = subs?.filter((s) => s.status === "trialing").length || 0;
      const activeCount = subs?.filter((s) => s.status === "active").length || 0;
      const suspendedCount = subs?.filter((s) => s.status === "past_due").length || 0;
      const expiredCount = subs?.filter((s) => s.status === "expired").length || 0;

      // Average trial length
      const trialLengths = subs?.filter((s) => s.trial_started_at && s.trial_ends_at)
        .map((s) => differenceInDays(new Date(s.trial_ends_at!), new Date(s.trial_started_at!)));
      const avgTrialLength = trialLengths && trialLengths.length > 0
        ? trialLengths.reduce((a, b) => a + b, 0) / trialLengths.length
        : 90;

      return {
        conversionRate,
        churnRate,
        estimatedMRR,
        totalOrgs,
        trialingCount,
        activeCount,
        suspendedCount,
        expiredCount,
        avgTrialLength,
        cohorts: sortedCohorts,
        periodStart,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando métricas SaaS...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period Selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">Período:</span>
        <Select value={periodMonths.toString()} onValueChange={(v) => setPeriodMonths(parseInt(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Último mes</SelectItem>
            <SelectItem value="3">Últimos 3 meses</SelectItem>
            <SelectItem value="6">Últimos 6 meses</SelectItem>
            <SelectItem value="12">Último año</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Conversión Trial→Paid</p>
                <div className="text-2xl font-bold">
                  {metricsData?.conversionRate.toFixed(1)}%
                </div>
              </div>
              <div className={`p-2 rounded-full ${metricsData?.conversionRate >= 10 ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"}`}>
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tasa de Churn</p>
                <div className="text-2xl font-bold">
                  {metricsData?.churnRate.toFixed(1)}%
                </div>
              </div>
              <div className={`p-2 rounded-full ${metricsData?.churnRate <= 5 ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}`}>
                <TrendingDown className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">MRR Estimado</p>
                <div className="text-2xl font-bold">
                  ${metricsData?.estimatedMRR.toLocaleString()}
                </div>
              </div>
              <div className="p-2 rounded-full bg-primary/10 text-primary">
                <DollarSign className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Promedio Trial</p>
                <div className="text-2xl font-bold">
                  {Math.round(metricsData?.avgTrialLength || 0)} días
                </div>
              </div>
              <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                <Calendar className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Distribución de Estados
          </CardTitle>
          <CardDescription>
            {metricsData?.totalOrgs} organizaciones totales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-blue-100 text-blue-800">Prueba</Badge>
              </div>
              <div className="text-2xl font-bold">{metricsData?.trialingCount}</div>
            </div>
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-green-100 text-green-800">Activos</Badge>
              </div>
              <div className="text-2xl font-bold">{metricsData?.activeCount}</div>
            </div>
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-amber-100 text-amber-800">Suspendidos</Badge>
              </div>
              <div className="text-2xl font-bold">{metricsData?.suspendedCount}</div>
            </div>
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-red-100 text-red-800">Expirados</Badge>
              </div>
              <div className="text-2xl font-bold">{metricsData?.expiredCount}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cohort Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Análisis de Cohortes
          </CardTitle>
          <CardDescription>
            Progresión de organizaciones por mes de registro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Cohorte</th>
                  <th className="text-center py-2 px-3 font-medium">Total</th>
                  <th className="text-center py-2 px-3 font-medium">Prueba</th>
                  <th className="text-center py-2 px-3 font-medium">Activos</th>
                  <th className="text-center py-2 px-3 font-medium">Churn</th>
                  <th className="text-center py-2 px-3 font-medium">Conversión</th>
                </tr>
              </thead>
              <tbody>
                {metricsData?.cohorts.map(([monthKey, data]) => {
                  const convRate = data.total > 0 ? (data.active / data.total) * 100 : 0;
                  const isPositive = convRate >= 10;
                  return (
                    <tr key={monthKey} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 font-medium">
                        {format(new Date(monthKey + "-01"), "MMM yyyy", { locale: es })}
                      </td>
                      <td className="text-center py-2 px-3">{data.total}</td>
                      <td className="text-center py-2 px-3">
                        <Badge variant="outline" className="bg-blue-50">{data.trialing}</Badge>
                      </td>
                      <td className="text-center py-2 px-3">
                        <Badge variant="outline" className="bg-green-50">{data.active}</Badge>
                      </td>
                      <td className="text-center py-2 px-3">
                        <Badge variant="outline" className="bg-red-50">{data.churned}</Badge>
                      </td>
                      <td className="text-center py-2 px-3">
                        <div className={`inline-flex items-center gap-1 ${isPositive ? "text-green-600" : "text-amber-600"}`}>
                          {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {convRate.toFixed(0)}%
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
