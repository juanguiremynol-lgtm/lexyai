/**
 * AteniaProviderHealthDashboard — Shows provider health with active mitigations.
 *
 * Provider data is fetched via shared adapters (_shared/providerAdapters/):
 *   cpnuAdapter, samaiAdapter, publicacionesAdapter, samaiEstadosAdapter, tutelasAdapter
 * Routing per category is defined in providerRegistry.ts (getProvidersForCategory).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Activity, Loader2 } from "lucide-react";

interface Props {
  organizationId: string;
}

interface ProviderStats {
  provider: string;
  total: number;
  errors: number;
  errorRate: number;
  avgLatency: number;
}

export function AteniaProviderHealthDashboard({ organizationId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["provider-health-dashboard", organizationId],
    queryFn: async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const [tracesRes, mitigationsRes] = await Promise.all([
        (supabase.from("sync_traces") as any)
          .select("provider, success, latency_ms")
          .eq("organization_id", organizationId)
          .gte("created_at", twoHoursAgo),
        (supabase.from("provider_route_mitigations") as any)
          .select("*")
          .eq("expired", false),
      ]);

      const traces = tracesRes.data || [];
      const mitigations = mitigationsRes.data || [];

      // Group traces by provider
      const byProvider = new Map<string, any[]>();
      for (const t of traces) {
        const p = t.provider || "unknown";
        if (!byProvider.has(p)) byProvider.set(p, []);
        byProvider.get(p)!.push(t);
      }

      const stats: ProviderStats[] = [];
      for (const [provider, provTraces] of byProvider) {
        const total = provTraces.length;
        const errors = provTraces.filter((t: any) => !t.success).length;
        const avgLatency = total > 0
          ? Math.round(provTraces.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / total)
          : 0;
        stats.push({
          provider,
          total,
          errors,
          errorRate: total > 0 ? Math.round((errors / total) * 100) : 0,
          avgLatency,
        });
      }

      return { stats, mitigations };
    },
    refetchInterval: 120_000,
  });

  // Map provider keys to adapter info for tooltip
  const adapterInfo: Record<string, { adapter: string; scope: string; table: string }> = {
    cpnu: { adapter: "cpnuAdapter.ts", scope: "ACTUACIONES", table: "work_item_acts" },
    samai: { adapter: "samaiAdapter.ts", scope: "ACTUACIONES", table: "work_item_acts" },
    tutelas: { adapter: "tutelasAdapter.ts", scope: "ACTUACIONES", table: "work_item_acts" },
    publicaciones: { adapter: "publicacionesAdapter.ts", scope: "ESTADOS", table: "work_item_publicaciones" },
    samai_estados: { adapter: "samaiEstadosAdapter.ts", scope: "ESTADOS", table: "work_item_publicaciones" },
  };

  const healthColor = (errorRate: number) => {
    if (errorRate >= 50) return "text-red-500";
    if (errorRate >= 20) return "text-amber-500";
    return "text-green-500";
  };

  const healthDot = (errorRate: number) => {
    if (errorRate >= 50) return "🔴";
    if (errorRate >= 20) return "🟡";
    return "🟢";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Salud de Proveedores (últimas 2h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.stats.length ? (
          <p className="text-sm text-muted-foreground">Sin datos de proveedores recientes.</p>
        ) : (
          <TooltipProvider>
          <div className="space-y-3">
            {data.stats.map((s) => {
              const activeMitigations = (data.mitigations || []).filter(
                (m: any) => m.provider === s.provider && !m.expired,
              );
              const info = adapterInfo[s.provider.toLowerCase()];
              return (
                <div key={s.provider} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{healthDot(s.errorRate)}</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-medium cursor-help">{s.provider}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="text-xs">
                          {info ? (
                            <div className="space-y-0.5">
                              <div>Adapter: <span className="font-mono">{info.adapter}</span></div>
                              <div>Scope: {info.scope} → {info.table}</div>
                            </div>
                          ) : (
                            <span>Proveedor externo</span>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className={healthColor(s.errorRate)}>Errores: {s.errorRate}%</span>
                      <span>Lat: {(s.avgLatency / 1000).toFixed(1)}s</span>
                      <span>{s.total} consultas</span>
                    </div>
                  </div>
                  {activeMitigations.length > 0 &&
                    activeMitigations.map((m: any) => (
                      <div key={m.id} className="ml-6 text-xs flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          ⚠️ {m.mitigation_type}
                        </Badge>
                        <span className="text-muted-foreground">
                          expira {new Date(m.expires_at).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
