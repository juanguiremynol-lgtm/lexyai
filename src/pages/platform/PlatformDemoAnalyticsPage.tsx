/**
 * Platform Demo Analytics Page — Super Admin dashboard for demo usage.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Eye, Search, CheckCircle, MousePointerClick, Clock,
  TrendingUp, Globe, Tag, ShieldAlert, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line, Legend,
} from "recharts";

type TimeRange = "24h" | "7d" | "30d";

function getTimeRangeFilter(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case "24h": return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    case "7d": return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
}

export default function PlatformDemoAnalyticsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

  const since = getTimeRangeFilter(timeRange);

  const { data: events, isLoading } = useQuery({
    queryKey: ["demo-analytics-events", timeRange],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demo_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!events) return null;

    const views = events.filter((e) => e.event_name === "demo_view");
    const lookups = events.filter((e) => e.event_name === "demo_lookup_submitted");
    const results = events.filter((e) => e.event_name === "demo_lookup_result");
    const ctaClicks = events.filter((e) => e.event_name === "demo_cta_clicked");
    const rateLimited = events.filter((e) => e.event_name === "demo_rate_limited");

    const successes = results.filter(
      (e) => e.outcome === "FOUND_COMPLETE" || e.outcome === "FOUND_PARTIAL",
    );
    const successRate = results.length > 0 ? (successes.length / results.length) * 100 : 0;
    const ctaRate = views.length > 0 ? (ctaClicks.length / views.length) * 100 : 0;

    const latencies = results.map((e) => e.latency_ms).filter((l): l is number => l != null);
    const avgLatency = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const p95Latency = sortedLat.length > 0
      ? sortedLat[Math.floor(sortedLat.length * 0.95)] || 0
      : 0;

    const uniqueSessions = new Set(events.map((e) => e.session_id).filter(Boolean)).size;

    // Breakdowns
    const byRoute = groupBy(events, "route");
    const byReferrer = groupBy(events, "referrer_domain");
    const byCategory = groupBy(results, "category_inferred");
    const byOutcome = groupBy(results, "outcome");
    const byCta = groupBy(ctaClicks, "cta_type");

    // Time series (daily)
    const daily = buildTimeSeries(events, timeRange);

    // Abuse panel
    const topIpHashes = topN(
      events.filter((e) => e.ip_hash),
      "ip_hash",
      10,
    );
    const topRadicadoHashes = topN(
      events.filter((e) => e.radicado_hash),
      "radicado_hash",
      10,
    );
    const topReferrers = topN(
      events.filter((e) => e.referrer_domain),
      "referrer_domain",
      10,
    );

    return {
      views: views.length,
      lookups: lookups.length,
      results: results.length,
      successes: successes.length,
      successRate,
      ctaClicks: ctaClicks.length,
      ctaRate,
      avgLatency,
      p95Latency,
      uniqueSessions,
      rateLimited: rateLimited.length,
      byRoute,
      byReferrer,
      byCategory,
      byOutcome,
      byCta,
      daily,
      topIpHashes,
      topRadicadoHashes,
      topReferrers,
    };
  }, [events, timeRange]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Demo Analytics</h1>
          <p className="text-white/50 text-sm">Uso y conversión del demo público</p>
        </div>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-32 bg-white/5 border-white/10 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">24 horas</SelectItem>
            <SelectItem value="7d">7 días</SelectItem>
            <SelectItem value="30d">30 días</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-white/40 text-center py-12">Cargando datos...</div>
      ) : !stats ? (
        <div className="text-white/40 text-center py-12">Sin datos disponibles</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard icon={Eye} label="Demo Views" value={stats.views} />
            <KpiCard icon={Search} label="Lookups" value={stats.lookups} />
            <KpiCard icon={CheckCircle} label="Tasa Éxito" value={`${stats.successRate.toFixed(1)}%`} />
            <KpiCard icon={MousePointerClick} label="CTA Rate" value={`${stats.ctaRate.toFixed(1)}%`} />
            <KpiCard icon={Clock} label="Avg Latency" value={`${stats.avgLatency}ms`} />
            <KpiCard icon={TrendingUp} label="Sesiones" value={stats.uniqueSessions} />
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="bg-white/5 border border-white/10">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white/10 text-white/70 data-[state=active]:text-white">
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Resumen
              </TabsTrigger>
              <TabsTrigger value="breakdown" className="data-[state=active]:bg-white/10 text-white/70 data-[state=active]:text-white">
                <Tag className="h-3.5 w-3.5 mr-1.5" /> Desglose
              </TabsTrigger>
              <TabsTrigger value="abuse" className="data-[state=active]:bg-white/10 text-white/70 data-[state=active]:text-white">
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" /> Abuso
                {stats.rateLimited > 0 && (
                  <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">{stats.rateLimited}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Overview */}
            <TabsContent value="overview" className="space-y-4">
              <Card className="bg-white/5 border-white/10">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Actividad diaria</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={stats.daily}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} />
                        <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }} />
                        <RechartsTooltip
                          contentStyle={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="views" stroke="#06b6d4" name="Views" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="lookups" stroke="#f59e0b" name="Lookups" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="successes" stroke="#10b981" name="Éxitos" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="cta_clicks" stroke="#8b5cf6" name="CTA" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-2 gap-4">
                <BreakdownCard title="Por Resultado" data={stats.byOutcome} />
                <BreakdownCard title="Por Categoría Inferida" data={stats.byCategory} />
              </div>
            </TabsContent>

            {/* Breakdown */}
            <TabsContent value="breakdown" className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <BreakdownCard title="Por Ruta/Origen" data={stats.byRoute} />
                <BreakdownCard title="Por Dominio Referrer" data={stats.byReferrer} />
                <BreakdownCard title="Por Tipo CTA" data={stats.byCta} />
                <Card className="bg-white/5 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Latencia</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">Promedio</span>
                      <span className="text-white font-mono">{stats.avgLatency}ms</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-white/50">P95</span>
                      <span className="text-white font-mono">{stats.p95Latency}ms</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Abuse */}
            <TabsContent value="abuse" className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="bg-white/5 border-white/10">
                  <CardHeader>
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-amber-400" />
                      Rate Limit Triggers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold text-white">{stats.rateLimited}</p>
                    <p className="text-xs text-white/40 mt-1">en período seleccionado</p>
                  </CardContent>
                </Card>

                <TopHashCard title="Top IP Hashes (vol)" data={stats.topIpHashes} />
                <TopHashCard title="Top Radicado Hashes (vol)" data={stats.topRadicadoHashes} />
                <TopHashCard title="Top Referrer Domains" data={stats.topReferrers} />
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ── Helpers ──

function KpiCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className="h-3.5 w-3.5 text-cyan-400" />
          <span className="text-[11px] text-white/40 uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-xl font-bold text-white tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, data }: { title: string; data: Record<string, number> }) {
  const sorted = Object.entries(data).sort(([, a], [, b]) => b - a).slice(0, 10);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {sorted.length === 0 ? (
          <p className="text-white/30 text-sm">Sin datos</p>
        ) : (
          sorted.map(([key, count]) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-white/60 truncate max-w-[60%]">{key || "(vacío)"}</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono">{count}</span>
                <span className="text-white/30 text-xs w-12 text-right">
                  {total > 0 ? `${((count / total) * 100).toFixed(0)}%` : ""}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TopHashCard({ title, data }: { title: string; data: [string, number][] }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle className="text-white text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {data.length === 0 ? (
          <p className="text-white/30 text-sm">Sin datos</p>
        ) : (
          data.map(([hash, count]) => (
            <div key={hash} className="flex items-center justify-between text-sm">
              <span className="text-white/40 font-mono text-xs truncate max-w-[65%]">
                {hash.length > 16 ? hash.slice(0, 8) + "…" + hash.slice(-8) : hash}
              </span>
              <span className="text-white font-mono">{count}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function groupBy(items: any[], key: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const val = item[key] || "(vacío)";
    result[val] = (result[val] || 0) + 1;
  }
  return result;
}

function topN(items: any[], key: string, n: number): [string, number][] {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const val = item[key];
    if (val) counts[val] = (counts[val] || 0) + 1;
  }
  return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, n);
}

function buildTimeSeries(events: any[], range: TimeRange) {
  const buckets: Record<string, { views: number; lookups: number; successes: number; cta_clicks: number }> = {};

  for (const e of events) {
    const d = new Date(e.created_at);
    const label = range === "24h"
      ? `${d.getHours().toString().padStart(2, "0")}:00`
      : `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;

    if (!buckets[label]) buckets[label] = { views: 0, lookups: 0, successes: 0, cta_clicks: 0 };

    if (e.event_name === "demo_view") buckets[label].views++;
    if (e.event_name === "demo_lookup_submitted") buckets[label].lookups++;
    if (e.event_name === "demo_lookup_result" && (e.outcome === "FOUND_COMPLETE" || e.outcome === "FOUND_PARTIAL"))
      buckets[label].successes++;
    if (e.event_name === "demo_cta_clicked") buckets[label].cta_clicks++;
  }

  return Object.entries(buckets)
    .map(([label, data]) => ({ label, ...data }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
