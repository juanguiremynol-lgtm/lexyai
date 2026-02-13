/**
 * AteniaComprehensiveAuditWizard — Single-click wizard that runs all Atenia AI
 * diagnostic tools in parallel and produces a unified report for the super admin.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadConfig, buildPlatformHealthPrompt, callGeminiViaEdge } from "@/lib/services/atenia-ai-engine";
import { evaluateExternalProviderHealth } from "@/lib/services/atenia-ai-external-providers";
import { runAutonomyCycle } from "@/lib/services/atenia-ai-autonomy-engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain, Play, Loader2, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ShieldCheck, CalendarSync, Server, Ghost, Plug,
  Activity, Zap, Settings, RefreshCw, FileText, Clock,
} from "lucide-react";
import { toast } from "sonner";

const PLATFORM_ORG_ID = "a0000000-0000-0000-0000-000000000001";

type CheckStatus = "idle" | "running" | "ok" | "warn" | "error";

interface CheckResult {
  status: CheckStatus;
  label: string;
  icon: React.ReactNode;
  summary: string;
  details?: any;
  severity: "ok" | "warn" | "error";
}

interface AuditState {
  running: boolean;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  checks: Record<string, CheckResult>;
}

const CHECK_DEFS = [
  { key: "daily_sync", label: "Sync Diario", icon: <CalendarSync className="h-4 w-4" /> },
  { key: "assurance_gates", label: "Puertas de Aseguramiento", icon: <ShieldCheck className="h-4 w-4" /> },
  { key: "edge_functions", label: "Edge Functions Liveness", icon: <Server className="h-4 w-4" /> },
  { key: "ghost_items", label: "Ítems Fantasma", icon: <Ghost className="h-4 w-4" /> },
  { key: "ext_providers", label: "Proveedores Externos", icon: <Plug className="h-4 w-4" /> },
  { key: "provider_health", label: "Salud de Proveedores", icon: <Activity className="h-4 w-4" /> },
  { key: "remediation_queue", label: "Cola de Remediación", icon: <Zap className="h-4 w-4" /> },
  { key: "actions_log", label: "Log de Acciones", icon: <FileText className="h-4 w-4" /> },
  { key: "config_status", label: "Configuración AI", icon: <Settings className="h-4 w-4" /> },
  { key: "ai_health_audit", label: "Auditoría AI (Gemini)", icon: <Brain className="h-4 w-4" /> },
] as const;

function todayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

function statusIcon(status: CheckStatus) {
  switch (status) {
    case "running": return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    case "ok": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "warn": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case "error": return <XCircle className="h-4 w-4 text-red-500" />;
    default: return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function severityBadge(severity: "ok" | "warn" | "error") {
  switch (severity) {
    case "ok": return <Badge variant="default" className="text-xs">OK</Badge>;
    case "warn": return <Badge variant="secondary" className="text-xs">Advertencia</Badge>;
    case "error": return <Badge variant="destructive" className="text-xs">Error</Badge>;
  }
}

const defaultCheck = (key: string): CheckResult => ({
  status: "idle",
  label: CHECK_DEFS.find(c => c.key === key)?.label || key,
  icon: CHECK_DEFS.find(c => c.key === key)?.icon || <Clock className="h-4 w-4" />,
  summary: "Pendiente",
  severity: "ok",
});

export function AteniaComprehensiveAuditWizard() {
  const [audit, setAudit] = useState<AuditState>({
    running: false,
    progress: 0,
    startedAt: null,
    finishedAt: null,
    checks: Object.fromEntries(CHECK_DEFS.map(c => [c.key, defaultCheck(c.key)])),
  });
  const [selectedChecks, setSelectedChecks] = useState<Set<string>>(
    new Set(CHECK_DEFS.map(c => c.key))
  );

  const updateCheck = useCallback((key: string, partial: Partial<CheckResult>) => {
    setAudit(prev => ({
      ...prev,
      checks: { ...prev.checks, [key]: { ...prev.checks[key], ...partial } },
    }));
  }, []);

  const toggleCheck = (key: string) => {
    setSelectedChecks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedChecks(new Set(CHECK_DEFS.map(c => c.key)));
  const selectNone = () => setSelectedChecks(new Set());

  // ---- Individual check runners ----

  const runDailySync = async (): Promise<CheckResult> => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await (supabase.from("auto_sync_daily_ledger") as any)
      .select("id,run_date,status,items_targeted,items_succeeded,items_failed")
      .gte("run_date", sevenDaysAgo)
      .order("run_date", { ascending: false })
      .limit(14);

    const runs = data || [];
    const successCount = runs.filter((r: any) => r.status === "SUCCESS").length;
    const totalRuns = runs.length;
    const rate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0;

    const severity: "ok" | "warn" | "error" = rate >= 90 ? "ok" : rate >= 50 ? "warn" : "error";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Sync Diario",
      icon: <CalendarSync className="h-4 w-4" />,
      summary: `${successCount}/${totalRuns} ejecuciones exitosas (${rate}%) últimos 7 días`,
      details: { runs, rate },
      severity,
    };
  };

  const runAssuranceGates = async (): Promise<CheckResult> => {
    const { data, error } = await supabase.functions.invoke("atenia-ai-supervisor", {
      body: { mode: "ASSURANCE_CHECK" },
    });
    if (error) return { status: "error", label: "Puertas de Aseguramiento", icon: <ShieldCheck className="h-4 w-4" />, summary: `Error: ${error.message}`, severity: "error" };

    const gates = data?.gates || {};
    const allOk = data?.all_ok ?? false;
    const failedGates = Object.entries(gates).filter(([, v]: any) => !v.ok).map(([k]) => k);

    return {
      status: allOk ? "ok" : "error",
      label: "Puertas de Aseguramiento",
      icon: <ShieldCheck className="h-4 w-4" />,
      summary: allOk ? "Todas las puertas OK" : `${failedGates.length} puerta(s) fallida(s): ${failedGates.join(", ")}`,
      details: gates,
      severity: allOk ? "ok" : "error",
    };
  };

  const runEdgeFunctions = async (): Promise<CheckResult> => {
    const CRITICAL_FNS = [
      "scheduled-daily-sync", "scheduled-publicaciones-monitor", "sync-by-work-item",
      "sync-publicaciones-by-work-item", "fallback-sync-check", "atenia-ai-supervisor",
      "provider-sync-external-provider",
    ];
    const results: Record<string, { ok: boolean; status?: number }> = {};
    await Promise.all(CRITICAL_FNS.map(async fn => {
      try {
        const res = await supabase.functions.invoke(fn, { body: undefined, headers: {} } as any);
        results[fn] = { ok: !res.error, status: res.error ? 500 : 200 };
      } catch {
        results[fn] = { ok: false, status: 0 };
      }
    }));

    const downCount = Object.values(results).filter(r => !r.ok).length;
    const severity: "ok" | "warn" | "error" = downCount === 0 ? "ok" : downCount <= 2 ? "warn" : "error";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Edge Functions Liveness",
      icon: <Server className="h-4 w-4" />,
      summary: downCount === 0 ? `${CRITICAL_FNS.length} funciones activas` : `${downCount} función(es) caída(s)`,
      details: results,
      severity,
    };
  };

  const runGhostItems = async (): Promise<CheckResult> => {
    const { data } = await (supabase.from("atenia_ai_work_item_state") as any)
      .select("work_item_id, consecutive_not_found, consecutive_timeouts, consecutive_other_errors, last_error_code")
      .or("consecutive_not_found.gte.3,consecutive_timeouts.gte.3,consecutive_other_errors.gte.3")
      .limit(100);

    const ghosts = data || [];
    const severity: "ok" | "warn" | "error" = ghosts.length === 0 ? "ok" : ghosts.length <= 5 ? "warn" : "error";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Ítems Fantasma",
      icon: <Ghost className="h-4 w-4" />,
      summary: ghosts.length === 0 ? "Sin ítems fantasma" : `${ghosts.length} ítem(s) con fallos consecutivos`,
      details: { count: ghosts.length, items: ghosts.slice(0, 10) },
      severity,
    };
  };

  const runExtProviders = async (): Promise<CheckResult> => {
    const health = await evaluateExternalProviderHealth(PLATFORM_ORG_ID);
    const obCount = health.observations.length;
    const severity: "ok" | "warn" | "error" = obCount === 0 ? "ok" : health.observations.some(o => (o.severity as string) === "CRITICAL") ? "error" : "warn";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Proveedores Externos",
      icon: <Plug className="h-4 w-4" />,
      summary: obCount === 0 ? "Todos los proveedores saludables" : `${obCount} observación(es) detectada(s)`,
      details: health,
      severity,
    };
  };

  const runProviderHealth = async (): Promise<CheckResult> => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: traces } = await (supabase.from("sync_traces") as any)
      .select("provider, success, latency_ms")
      .eq("organization_id", PLATFORM_ORG_ID)
      .gte("created_at", twoHoursAgo);

    const { data: mitigations } = await (supabase.from("provider_route_mitigations") as any)
      .select("*")
      .eq("expired", false);

    const allTraces = traces || [];
    const errors = allTraces.filter((t: any) => !t.success).length;
    const total = allTraces.length;
    const errorRate = total > 0 ? Math.round((errors / total) * 100) : 0;
    const activeMitigations = (mitigations || []).length;

    const severity: "ok" | "warn" | "error" = errorRate <= 5 ? "ok" : errorRate <= 20 ? "warn" : "error";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Salud de Proveedores",
      icon: <Activity className="h-4 w-4" />,
      summary: `${total} trazas, ${errorRate}% errores${activeMitigations > 0 ? `, ${activeMitigations} mitigación(es) activa(s)` : ""}`,
      details: { total, errors, errorRate, activeMitigations },
      severity,
    };
  };

  const runRemediationQueue = async (): Promise<CheckResult> => {
    const { data } = await (supabase.from("atenia_ai_remediation_queue") as any)
      .select("id, status, action_type, priority")
      .in("status", ["PENDING", "RUNNING"])
      .limit(100);

    const items = data || [];
    const pending = items.filter((i: any) => i.status === "PENDING").length;
    const running = items.filter((i: any) => i.status === "RUNNING").length;
    const highPriority = items.filter((i: any) => i.priority >= 80).length;

    const severity: "ok" | "warn" | "error" = items.length === 0 ? "ok" : highPriority > 0 ? "warn" : "ok";
    return {
      status: severity === "ok" ? "ok" : "warn",
      label: "Cola de Remediación",
      icon: <Zap className="h-4 w-4" />,
      summary: items.length === 0 ? "Cola vacía" : `${pending} pendiente(s), ${running} ejecutando, ${highPriority} alta prioridad`,
      details: { total: items.length, pending, running, highPriority },
      severity,
    };
  };

  const runActionsLog = async (): Promise<CheckResult> => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await (supabase.from("atenia_ai_actions") as any)
      .select("action_type, action_result, status")
      .eq("organization_id", PLATFORM_ORG_ID)
      .gte("created_at", oneDayAgo)
      .limit(200);

    const actions = data || [];
    const failed = actions.filter((a: any) => a.action_result === "FAILED" || a.status === "FAILED").length;
    const total = actions.length;

    const severity: "ok" | "warn" | "error" = failed === 0 ? "ok" : failed <= 3 ? "warn" : "error";
    return {
      status: severity === "ok" ? "ok" : severity === "warn" ? "warn" : "error",
      label: "Log de Acciones",
      icon: <FileText className="h-4 w-4" />,
      summary: `${total} acciones (24h), ${failed} fallida(s)`,
      details: { total, failed, actions: actions.slice(0, 20) },
      severity,
    };
  };

  const runConfigStatus = async (): Promise<CheckResult> => {
    const config = await loadConfig(PLATFORM_ORG_ID);
    const issues: string[] = [];
    if (!config.gemini_enabled) issues.push("Gemini desactivado");
    if (config.autonomy_paused) issues.push("Autonomía pausada");
    if ((config as any).paused_until) issues.push("AI pausada temporalmente");

    const severity: "ok" | "warn" | "error" = issues.length === 0 ? "ok" : "warn";
    return {
      status: severity === "ok" ? "ok" : "warn",
      label: "Configuración AI",
      icon: <Settings className="h-4 w-4" />,
      summary: issues.length === 0 ? "Configuración nominal" : issues.join(", "),
      details: config,
      severity,
    };
  };

  const runAIHealthAudit = async (): Promise<CheckResult> => {
    try {
      const config = await loadConfig(PLATFORM_ORG_ID);
      if (!config.gemini_enabled) {
        return { status: "warn", label: "Auditoría AI", icon: <Brain className="h-4 w-4" />, summary: "Gemini desactivado — omitido", severity: "warn" };
      }
      const prompt = await buildPlatformHealthPrompt(PLATFORM_ORG_ID);
      const result = await callGeminiViaEdge(prompt);
      return {
        status: "ok",
        label: "Auditoría AI (Gemini)",
        icon: <Brain className="h-4 w-4" />,
        summary: "Auditoría completada exitosamente",
        details: { analysis: result },
        severity: "ok",
      };
    } catch (err: any) {
      return { status: "error", label: "Auditoría AI", icon: <Brain className="h-4 w-4" />, summary: `Error: ${err.message}`, severity: "error" };
    }
  };

  const CHECK_RUNNERS: Record<string, () => Promise<CheckResult>> = {
    daily_sync: runDailySync,
    assurance_gates: runAssuranceGates,
    edge_functions: runEdgeFunctions,
    ghost_items: runGhostItems,
    ext_providers: runExtProviders,
    provider_health: runProviderHealth,
    remediation_queue: runRemediationQueue,
    actions_log: runActionsLog,
    config_status: runConfigStatus,
    ai_health_audit: runAIHealthAudit,
  };

  const runAudit = async () => {
    const checksToRun = Array.from(selectedChecks);
    if (checksToRun.length === 0) { toast.error("Selecciona al menos un chequeo"); return; }

    // Reset
    setAudit(prev => ({
      ...prev,
      running: true,
      progress: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      checks: Object.fromEntries(CHECK_DEFS.map(c => [
        c.key,
        checksToRun.includes(c.key)
          ? { ...defaultCheck(c.key), status: "running" as const }
          : defaultCheck(c.key),
      ])),
    }));

    let completed = 0;

    // Run all selected checks in parallel
    await Promise.all(checksToRun.map(async (key) => {
      try {
        const runner = CHECK_RUNNERS[key];
        if (!runner) return;
        const result = await runner();
        updateCheck(key, result);
      } catch (err: any) {
        updateCheck(key, {
          status: "error",
          summary: `Error inesperado: ${err.message}`,
          severity: "error",
        });
      } finally {
        completed++;
        setAudit(prev => ({ ...prev, progress: Math.round((completed / checksToRun.length) * 100) }));
      }
    }));

    setAudit(prev => ({ ...prev, running: false, finishedAt: new Date().toISOString() }));
    toast.success("Auditoría completa");
  };

  const overallSeverity = (): "ok" | "warn" | "error" => {
    const checks = Object.values(audit.checks).filter(c => c.status !== "idle");
    if (checks.some(c => c.severity === "error")) return "error";
    if (checks.some(c => c.severity === "warn")) return "warn";
    return "ok";
  };

  const hasResults = Object.values(audit.checks).some(c => c.status !== "idle" && c.status !== "running");
  const overall = overallSeverity();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Auditoría Integral — Atenia AI</h2>
            <p className="text-sm text-muted-foreground">
              Ejecuta todos los diagnósticos en paralelo y obtén un reporte unificado.
            </p>
          </div>
        </div>
      </div>

      {/* Check Selector */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Diagnósticos a ejecutar</CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs">
                Seleccionar todos
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNone} className="text-xs">
                Ninguno
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            {CHECK_DEFS.map(c => (
              <button
                key={c.key}
                onClick={() => toggleCheck(c.key)}
                disabled={audit.running}
                className={`flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-all ${
                  selectedChecks.has(c.key)
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50"
                } ${audit.running ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                {c.icon}
                <span className="truncate text-xs font-medium">{c.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={runAudit}
              disabled={audit.running || selectedChecks.size === 0}
              className="gap-2"
              size="lg"
            >
              {audit.running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {audit.running
                ? `Ejecutando... (${audit.progress}%)`
                : `Ejecutar Auditoría (${selectedChecks.size} checks)`}
            </Button>

            {hasResults && !audit.running && (
              <Badge
                variant={overall === "ok" ? "default" : overall === "warn" ? "secondary" : "destructive"}
                className="text-sm px-3 py-1"
              >
                {overall === "ok" ? "✅ Todo OK" : overall === "warn" ? "⚠️ Advertencias" : "❌ Errores detectados"}
              </Badge>
            )}
          </div>

          {audit.running && (
            <Progress value={audit.progress} className="mt-3 h-2" />
          )}
        </CardContent>
      </Card>

      {/* Results Report */}
      {hasResults && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Reporte de Auditoría
              </CardTitle>
              {audit.finishedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(audit.finishedAt).toLocaleTimeString("es-CO")}
                  {audit.startedAt && (
                    <> · {Math.round((new Date(audit.finishedAt).getTime() - new Date(audit.startedAt).getTime()) / 1000)}s</>
                  )}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Summary Grid */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {["ok", "warn", "error"].map(sev => {
                const count = Object.values(audit.checks).filter(c => c.severity === sev && c.status !== "idle").length;
                return (
                  <div key={sev} className={`rounded-lg border p-3 text-center ${
                    sev === "ok" ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30" :
                    sev === "warn" ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30" :
                    "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                  }`}>
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-muted-foreground">
                      {sev === "ok" ? "Saludables" : sev === "warn" ? "Advertencias" : "Errores"}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Individual Check Results */}
            <ScrollArea className="max-h-[600px]">
              <div className="space-y-2">
                {CHECK_DEFS.filter(c => audit.checks[c.key]?.status !== "idle").map(c => {
                  const check = audit.checks[c.key];
                  return (
                    <Collapsible key={c.key}>
                      <CollapsibleTrigger className="flex items-center gap-3 w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors group">
                        {statusIcon(check.status)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{check.label}</span>
                            {severityBadge(check.severity)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{check.summary}</p>
                        </div>
                        {check.details && (
                          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 group-data-[state=open]:rotate-180 transition-transform" />
                        )}
                      </CollapsibleTrigger>
                      {check.details && (
                        <CollapsibleContent className="px-3 pb-3">
                          <div className="mt-2 p-3 rounded bg-muted/30 border text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-auto">
                            {typeof check.details === "string"
                              ? check.details
                              : check.details.analysis
                                ? check.details.analysis
                                : JSON.stringify(check.details, null, 2)}
                          </div>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
