/**
 * Atenia AI Supervisor Panel — Platform admin view of sync diagnostics
 *
 * Shows daily audit reports, provider health, diagnostics, Gemini analysis,
 * autonomous actions log, AI config, health audit, and the Master Sync debug tool.
 * Only visible to platform admins.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MasterSyncPanel } from "./master-sync/MasterSyncPanel";
import { AteniaActionsLog } from "./atenia-ai/AteniaActionsLog";
import { AteniaConfigEditor } from "./atenia-ai/AteniaConfigEditor";
import { AteniaHealthAudit } from "./atenia-ai/AteniaHealthAudit";
import { AteniaAutonomousSyncPanel } from "./atenia-ai/AteniaAutonomousSyncPanel";
import { AteniaExternalProviderStatus } from "./atenia-ai/AteniaExternalProviderStatus";
import { AutopilotDashboard } from "./atenia-ai/AutopilotDashboard";
import { loadConfig } from "@/lib/services/atenia-ai-engine";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Brain,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface AteniaReport {
  id: string;
  organization_id: string;
  report_date: string;
  report_type: string;
  total_work_items: number;
  items_synced_ok: number;
  items_synced_partial: number;
  items_failed: number;
  new_actuaciones_found: number;
  new_publicaciones_found: number;
  provider_status: Record<string, {
    status: string;
    avg_latency_ms: number;
    errors: number;
    total_calls: number;
    error_pattern?: string;
  }>;
  diagnostics: Array<{
    work_item_id: string;
    radicado: string;
    severity: string;
    category: string;
    message_es: string;
    technical_detail: string;
    suggested_action?: string;
    auto_remediated?: boolean;
  }>;
  remediation_actions: Array<{
    action: string;
    work_item_id?: string;
    reason: string;
    result?: string;
  }>;
  ai_diagnosis: string | null;
  lexy_data_ready: boolean;
  created_at: string;
}

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

function ProviderStatusDot({ status }: { status: string }) {
  if (status === "healthy") return <span className="inline-block w-3 h-3 rounded-full bg-green-500" />;
  if (status === "degraded") return <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />;
  if (status === "down") return <span className="inline-block w-3 h-3 rounded-full bg-red-500" />;
  return <span className="inline-block w-3 h-3 rounded-full bg-muted" />;
}

function providerLabel(key: string): string {
  const labels: Record<string, string> = {
    cpnu: "Rama Judicial (CPNU)",
    samai: "Consejo de Estado (SAMAI)",
    tutelas: "Corte Constitucional",
    publicaciones: "Publicaciones Procesales",
  };
  return labels[key] || key;
}

function severityIcon(severity: string) {
  switch (severity) {
    case "CRITICO": return <XCircle className="h-4 w-4 text-red-500" />;
    case "PROBLEMA": return <AlertTriangle className="h-4 w-4 text-orange-500" />;
    case "AVISO": return <Clock className="h-4 w-4 text-yellow-500" />;
    default: return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  }
}

function severityBadgeVariant(severity: string): "destructive" | "secondary" | "outline" | "default" {
  switch (severity) {
    case "CRITICO": return "destructive";
    case "PROBLEMA": return "secondary";
    case "AVISO": return "outline";
    default: return "default";
  }
}

// Default org for platform admin
const PLATFORM_ORG_ID = 'a0000000-0000-0000-0000-000000000001';

export function AteniaAISupervisorPanel() {
  const [isAuditing, setIsAuditing] = useState(false);
  const today = todayCOT();

  // Load Atenia AI config for gemini_enabled check
  const { data: ateniaConfig } = useQuery({
    queryKey: ['atenia-config', PLATFORM_ORG_ID],
    queryFn: () => loadConfig(PLATFORM_ORG_ID),
    staleTime: 1000 * 60 * 5,
  });

  const { data: reports, isLoading, refetch } = useQuery({
    queryKey: ["atenia-ai-reports", today],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("atenia_ai_reports") as any)
        .select("*")
        .eq("report_date", today)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("[AteniaAI] Error fetching reports:", error.message);
        return [];
      }
      return (data || []) as AteniaReport[];
    },
    staleTime: 1000 * 60 * 2,
  });

  // Lexy messages sent today
  const { data: lexyStats } = useQuery({
    queryKey: ["atenia-lexy-stats", today],
    queryFn: async () => {
      const { count: lexyCount } = await (supabase
        .from("lexy_daily_messages") as any)
        .select("id", { count: "exact", head: true })
        .eq("message_date", today);

      // Total users who own monitored work items (potential Lexy recipients)
      const { data: users } = await supabase
        .from("work_items")
        .select("owner_id")
        .eq("monitoring_enabled", true);
      const uniqueUsers = new Set((users || []).map((u: any) => u.owner_id)).size;

      return { sent: lexyCount || 0, total: uniqueUsers };
    },
    staleTime: 1000 * 60 * 2,
  });

  // Alerts generated today
  const { data: alertStats } = useQuery({
    queryKey: ["atenia-alert-stats", today],
    queryFn: async () => {
      const dayStart = `${today}T00:00:00.000Z`;
      const { count: totalAlerts } = await supabase
        .from("alert_instances")
        .select("id", { count: "exact", head: true })
        .gte("fired_at", dayStart);

      const { count: criticalAlerts } = await supabase
        .from("alert_instances")
        .select("id", { count: "exact", head: true })
        .gte("fired_at", dayStart)
        .eq("severity", "CRITICAL");

      return { total: totalAlerts || 0, critical: criticalAlerts || 0 };
    },
    staleTime: 1000 * 60 * 2,
  });

  const handleManualAudit = async () => {
    setIsAuditing(true);
    try {
      const { error } = await supabase.functions.invoke("atenia-ai-supervisor", {
        body: { mode: "MANUAL_AUDIT" },
      });
      if (error) throw error;
      toast.success("Auditoría manual ejecutada. Recargando...");
      setTimeout(() => refetch(), 3000);
    } catch (err: any) {
      toast.error("Error al ejecutar auditoría: " + (err.message || "Error desconocido"));
    } finally {
      setIsAuditing(false);
    }
  };

  // Aggregate across all orgs
  const totalItems = reports?.reduce((s, r) => s + r.total_work_items, 0) || 0;
  const totalOk = reports?.reduce((s, r) => s + r.items_synced_ok, 0) || 0;
  const totalFailed = reports?.reduce((s, r) => s + r.items_failed, 0) || 0;
  const totalNewActs = reports?.reduce((s, r) => s + r.new_actuaciones_found, 0) || 0;
  const totalNewPubs = reports?.reduce((s, r) => s + r.new_publicaciones_found, 0) || 0;
  const syncRate = totalItems > 0 ? Math.round((totalOk / totalItems) * 100) : 0;

  // Aggregate provider status across reports
  const providerMap: Record<string, { status: string; avg_latency_ms: number; errors: number; total_calls: number }> = {};
  for (const report of reports || []) {
    for (const [key, val] of Object.entries(report.provider_status || {})) {
      if (!providerMap[key]) {
        providerMap[key] = { ...val };
      } else {
        providerMap[key].errors += val.errors;
        providerMap[key].total_calls += val.total_calls;
        providerMap[key].avg_latency_ms = Math.round((providerMap[key].avg_latency_ms + val.avg_latency_ms) / 2);
        if (val.status === "down") providerMap[key].status = "down";
        else if (val.status === "degraded" && providerMap[key].status !== "down") providerMap[key].status = "degraded";
      }
    }
  }

    // All diagnostics (non-OK), grouped by category+severity
  const rawDiagnostics = (reports || [])
    .flatMap((r) => (r.diagnostics || []))
    .filter((d) => d.severity !== "OK");

  // Group identical diagnostics by category+severity
  const groupedDiagnostics = (() => {
    const groups = new Map<string, { representative: typeof rawDiagnostics[0]; items: typeof rawDiagnostics; count: number }>();
    for (const d of rawDiagnostics) {
      const key = `${d.severity}::${d.category}`;
      if (!groups.has(key)) {
        groups.set(key, { representative: d, items: [d], count: 1 });
      } else {
        const g = groups.get(key)!;
        g.items.push(d);
        g.count++;
      }
    }
    return [...groups.values()].sort((a, b) => {
      const order: Record<string, number> = { CRITICO: 0, PROBLEMA: 1, AVISO: 2 };
      return (order[a.representative.severity] ?? 3) - (order[b.representative.severity] ?? 3);
    });
  })();

  const allDiagnosticsCount = rawDiagnostics.length;

  // All remediation actions
  const allActions = (reports || []).flatMap((r) => r.remediation_actions || []);

  // AI diagnosis from first report that has one
  const aiDiagnosis = reports?.find((r) => r.ai_diagnosis)?.ai_diagnosis || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Atenia AI — Panel de Supervisión</h2>
            <p className="text-sm text-muted-foreground">{today}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Recargar
          </Button>
          <Button size="sm" onClick={handleManualAudit} disabled={isAuditing}>
            {isAuditing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Activity className="h-4 w-4 mr-1" />}
            Auditar manualmente
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (reports?.length || 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay reportes de Atenia AI para hoy. El reporte se genera después de la sincronización diaria (7:30 AM COT).
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resumen del Día</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                <div>
                  <div className="text-2xl font-bold">{syncRate}%</div>
                  <div className="text-xs text-muted-foreground">Sincronizados ({totalOk}/{totalItems})</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{totalNewActs}</div>
                  <div className="text-xs text-muted-foreground">Nuevas actuaciones</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{totalNewPubs}</div>
                  <div className="text-xs text-muted-foreground">Nuevos estados</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-destructive">{totalFailed}</div>
                  <div className="text-xs text-muted-foreground">Fallos</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{alertStats?.total ?? 0}</div>
                  <div className="text-xs text-muted-foreground">
                    Alertas generadas
                    {(alertStats?.critical ?? 0) > 0 && (
                      <span className="text-destructive ml-1">({alertStats!.critical} críticas)</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{lexyStats?.sent ?? 0}/{lexyStats?.total ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Mensajes Lexy</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{allActions.length}</div>
                  <div className="text-xs text-muted-foreground">Acciones automáticas</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Provider Health */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Estado de Proveedores</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.keys(providerMap).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin datos de proveedores hoy.</p>
                ) : (
                  Object.entries(providerMap).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ProviderStatusDot status={val.status} />
                        <span className="text-sm font-medium">{providerLabel(key)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{val.status === "healthy" ? "Funcionando" : val.status === "degraded" ? "Lento" : val.status === "down" ? "Caído" : "Sin consultas"}</span>
                        <span>·</span>
                        <span>{val.avg_latency_ms > 0 ? `${(val.avg_latency_ms / 1000).toFixed(1)}s prom` : "—"}</span>
                        {val.errors > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-destructive">{val.errors} errores</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Diagnostics — grouped by category+severity */}
          {allDiagnosticsCount > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Diagnósticos ({allDiagnosticsCount})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {groupedDiagnostics.map((group, i) => {
                    const d = group.representative;
                    const label = group.count > 1
                      ? `${d.category} (${group.count} asuntos)`
                      : d.category;
                    return (
                      <Collapsible key={i}>
                        <CollapsibleTrigger className="flex items-start gap-2 w-full text-left group">
                          {severityIcon(d.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge variant={severityBadgeVariant(d.severity)} className="text-[10px] px-1.5 py-0">
                                {label}
                              </Badge>
                              {group.items.some((item) => item.auto_remediated) && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600">
                                  Auto-corregido
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm mt-1">{d.message_es}</p>
                          </div>
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-data-[state=open]:rotate-180 transition-transform" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="ml-6 mt-2 space-y-2">
                          {group.items.map((item, j) => (
                            <div key={j} className="space-y-1">
                              {group.count > 1 && (
                                <p className="text-xs font-medium text-muted-foreground">Radicado: {item.radicado}</p>
                              )}
                              <p className="text-xs text-muted-foreground font-mono">{item.technical_detail}</p>
                              {item.suggested_action && (
                                <p className="text-xs text-primary">💡 {item.suggested_action}</p>
                              )}
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Diagnosis */}
          {aiDiagnosis && (
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Análisis AI (Gemini)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm whitespace-pre-wrap leading-relaxed">{aiDiagnosis}</div>
              </CardContent>
            </Card>
          )}

          {/* Remediation Actions */}
          {allActions.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Acciones Automáticas</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {allActions.map((a, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">•</span>
                      <span className="font-medium">{a.action}</span>
                      <span className="text-muted-foreground">— {a.reason}</span>
                      {a.result && (
                        <Badge variant="outline" className="text-[10px]">{a.result}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Autopilot Control Plane */}
          <AutopilotDashboard organizationId={PLATFORM_ORG_ID} />

          {/* External Provider Health */}
          <AteniaExternalProviderStatus organizationId={PLATFORM_ORG_ID} />

          {/* Autonomous Sync Controls */}
          <AteniaAutonomousSyncPanel organizationId={PLATFORM_ORG_ID} />

          {/* Atenia AI Actions Log */}
          <AteniaActionsLog organizationId={PLATFORM_ORG_ID} />

          {/* Platform Health Audit */}
          <AteniaHealthAudit
            organizationId={PLATFORM_ORG_ID}
            geminiEnabled={ateniaConfig?.gemini_enabled ?? true}
          />

          {/* Atenia AI Configuration */}
          <AteniaConfigEditor organizationId={PLATFORM_ORG_ID} />

          {/* Master Sync Debug Tool */}
          <MasterSyncPanel />
        </>
      )}
    </div>
  );
}
