/**
 * AutopilotDashboard — Unified Atenia AI Control Plane.
 *
 * Displays: autopilot snapshot, cron health (proof-of-fire), sync coverage,
 * invariant violations, remediation queue, and watchdog status.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Bot,
  Loader2,
  ShieldAlert,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldCheck,
  Activity,
  Timer,
  Gauge,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  organizationId: string;
}

interface AutopilotSnapshot {
  ok: boolean;
  now: string;
  org_id: string;
  mode: string;
  config: Record<string, unknown>;
  health: {
    provider_status: Record<
      string,
      { avg_latency_ms: number; error_rate: number; degraded: boolean; total_calls: number; errors: number }
    >;
    sync: {
      total_monitored: number;
      synced_today: number;
      skipped_today: number;
      failures_today: number;
      scraping_pending_today: number;
      transient_without_retry: number;
      empty_result_count: number;
      empty_result_rate: number;
    };
    retry_queue: {
      pending_count: number;
      due_count: number;
      oldest_due_at: string | null;
      by_kind: Record<string, number>;
    };
    demonitors: {
      eligible_count: number;
      blocked_breakdown: Record<string, number>;
      executed_count: number;
    };
    invariants: {
      violations: Array<{
        code: string;
        severity: string;
        message: string;
        work_item_id?: string;
        radicado?: string;
      }>;
    };
  };
  actions_taken: Array<{
    type: string;
    work_item_id?: string;
    radicado?: string;
    reason: string;
  }>;
  duration_ms: number;
}

const JOB_NAMES = ["DAILY_ENQUEUE", "HEARTBEAT", "WATCHDOG", "PROCESS_QUEUE"] as const;

const JOB_LABELS: Record<string, string> = {
  DAILY_ENQUEUE: "Enqueue Diario",
  HEARTBEAT: "Heartbeat",
  WATCHDOG: "Watchdog",
  PROCESS_QUEUE: "Procesamiento de Cola",
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  OK: { icon: CheckCircle2, color: "text-green-500", label: "OK" },
  RUNNING: { icon: Loader2, color: "text-blue-500", label: "Ejecutando" },
  FAILED: { icon: XCircle, color: "text-red-500", label: "Fallido" },
  SKIPPED: { icon: Clock, color: "text-muted-foreground", label: "Omitido" },
};

export function AutopilotDashboard({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [isRunning, setIsRunning] = useState(false);
  const [isWatchdogRunning, setIsWatchdogRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<AutopilotSnapshot | null>(null);

  // Last autopilot action
  const { data: lastRun } = useQuery({
    queryKey: ["autopilot-last-run", organizationId],
    queryFn: async () => {
      const { data } = await (supabase.from("atenia_ai_actions") as any)
        .select("created_at, action_type, action_result, evidence")
        .eq("organization_id", organizationId)
        .in("action_type", ["ENQUEUE_RETRY", "CREATE_ALERT", "TRIGGER_SYNC", "AUTO_DEMONITOR", "WATCHDOG_RUN", "WATCHDOG_CORRECTIVE"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 60_000,
  });

  // Cron health
  const { data: cronRuns, refetch: refetchCron } = useQuery({
    queryKey: ["atenia-cron-health"],
    queryFn: async () => {
      const results: Record<string, any> = {};
      for (const job of JOB_NAMES) {
        const { data } = await (supabase
          .from("atenia_cron_runs") as any)
          .select("id, job_name, scheduled_for, started_at, finished_at, status, details")
          .eq("job_name", job)
          .order("started_at", { ascending: false })
          .limit(1);
        results[job] = data?.[0] ?? null;
      }
      return results;
    },
    refetchInterval: 60_000,
  });

  // Queue stats
  const { data: queueStats } = useQuery({
    queryKey: ["atenia-queue-stats"],
    queryFn: async () => {
      const statuses = ["PENDING", "RUNNING", "FAILED", "DONE"] as const;
      const counts: Record<string, number> = {};
      for (const s of statuses) {
        const { count } = await (supabase
          .from("atenia_ai_remediation_queue") as any)
          .select("id", { count: "exact", head: true })
          .eq("status", s);
        counts[s] = count ?? 0;
      }
      return counts;
    },
    refetchInterval: 60_000,
  });

  // Sync coverage
  const { data: coverage } = useQuery({
    queryKey: ["atenia-sync-coverage"],
    queryFn: async () => {
      const { data } = await supabase.rpc("atenia_get_missing_sync_coverage" as any);
      const row = Array.isArray(data) ? data[0] : data;
      return row as {
        total_monitored: number;
        attempted_24h: number;
        missing_attempts: number;
        coverage_pct: number;
      } | null;
    },
    refetchInterval: 120_000,
  });

  // Recent watchdog actions
  const { data: recentWatchdogActions } = useQuery({
    queryKey: ["watchdog-actions"],
    queryFn: async () => {
      const { data } = await (supabase.from("atenia_ai_actions") as any)
        .select("created_at, action_type, action_taken, action_result, reasoning, evidence")
        .in("action_type", ["WATCHDOG_RUN", "WATCHDOG_CORRECTIVE", "WATCHDOG_ALERT"])
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const handleRunAutopilot = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("atenia-ai-autopilot", {
        body: { mode: "ON_DEMAND", organization_id: organizationId },
      });
      if (error) throw error;
      setSnapshot(data as AutopilotSnapshot);
      toast.success(`Autopilot completado en ${data?.duration_ms || 0}ms`);
      queryClient.invalidateQueries({ queryKey: ["autopilot-last-run"] });
    } catch (err: any) {
      toast.error("Error ejecutando Autopilot: " + (err.message || "desconocido"));
    } finally {
      setIsRunning(false);
    }
  };

  const handleRunWatchdog = async () => {
    setIsWatchdogRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("atenia-ai-supervisor", {
        body: { mode: "WATCHDOG" },
      });
      if (error) throw error;
      toast.success("Watchdog ejecutado vía Atenia AI Supervisor");
      refetchCron();
      queryClient.invalidateQueries({ queryKey: ["watchdog-actions"] });
      queryClient.invalidateQueries({ queryKey: ["atenia-sync-coverage"] });
      queryClient.invalidateQueries({ queryKey: ["atenia-queue-stats"] });
    } catch (err: any) {
      toast.error("Error: " + (err.message || "desconocido"));
    } finally {
      setIsWatchdogRunning(false);
    }
  };

  const health = snapshot?.health;
  const violations = health?.invariants?.violations || [];
  const actionsTaken = snapshot?.actions_taken || [];
  const coveragePct = Number(coverage?.coverage_pct ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">Atenia AI — Control Plane</CardTitle>
              <CardDescription className="text-xs">
                Autopilot, Watchdog, Cron Health y Cobertura de Sync
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastRun?.created_at && (
              <span className="text-[10px] text-muted-foreground">
                Última acción:{" "}
                {formatDistanceToNow(new Date(lastRun.created_at), { addSuffix: true, locale: es })}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunWatchdog}
              disabled={isWatchdogRunning}
              className="gap-1.5 text-xs"
            >
              {isWatchdogRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              Watchdog
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleRunAutopilot}
              disabled={isRunning}
              className="gap-1.5 text-xs"
            >
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Autopilot
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ─── Cron Health: Proof-of-Fire ─── */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Timer className="h-4 w-4" />
            Proof-of-Fire (Último Run por Job)
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {JOB_NAMES.map((job) => {
              const run = cronRuns?.[job];
              const cfg = run ? STATUS_CONFIG[run.status] ?? STATUS_CONFIG.FAILED : null;
              const Icon = cfg?.icon ?? Clock;

              return (
                <div key={job} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <Icon className={`h-5 w-5 flex-shrink-0 ${cfg?.color ?? "text-muted-foreground"} ${run?.status === "RUNNING" ? "animate-spin" : ""}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{JOB_LABELS[job] ?? job}</p>
                    {run ? (
                      <p className="text-xs text-muted-foreground truncate">
                        {cfg?.label} — {run.finished_at
                          ? formatDistanceToNow(new Date(run.finished_at), { addSuffix: true, locale: es })
                          : run.started_at
                            ? `iniciado ${formatDistanceToNow(new Date(run.started_at), { addSuffix: true, locale: es })}`
                            : "sin datos"}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin ejecuciones</p>
                    )}
                  </div>
                  {run?.status && (
                    <Badge variant={run.status === "OK" ? "default" : run.status === "RUNNING" ? "secondary" : "destructive"} className="text-xs">
                      {cfg?.label ?? run.status}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* ─── Sync Coverage ─── */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Activity className="h-4 w-4" />
            Cobertura de Sync (24h)
          </h4>
          {coverage ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {coverage.attempted_24h} / {coverage.total_monitored} items con intento
                </span>
                <span className={`font-bold ${
                  coveragePct >= 90 ? "text-green-500" :
                  coveragePct >= 70 ? "text-amber-500" : "text-red-500"
                }`}>
                  {coveragePct}%
                </span>
              </div>
              <Progress
                value={Math.min(coveragePct, 100)}
                className="h-2"
              />
              {Number(coverage.missing_attempts) > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {coverage.missing_attempts} items sin sync en 24h
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin datos de cobertura</p>
          )}
        </div>

        <Separator />

        {/* ─── Queue Stats ─── */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Gauge className="h-4 w-4" />
            Cola de Remediación
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: "PENDING", label: "Pendientes", color: "text-amber-500" },
              { key: "RUNNING", label: "Ejecutando", color: "text-blue-500" },
              { key: "DONE", label: "Completadas", color: "text-green-500" },
              { key: "FAILED", label: "Fallidas", color: "text-red-500" },
            ].map(({ key, label, color }) => (
              <div key={key} className="text-center p-3 rounded-lg border bg-card">
                <p className={`text-2xl font-bold ${color}`}>{queueStats?.[key] ?? 0}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Recent Watchdog Actions ─── */}
        {recentWatchdogActions && recentWatchdogActions.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                Acciones Recientes del Watchdog
              </h4>
              <div className="space-y-1.5">
                {recentWatchdogActions.slice(0, 5).map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {a.action_result === "OK" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : a.action_result === "FAILED" ? (
                      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    )}
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {a.action_taken || a.action_type}
                    </Badge>
                    <span className="text-muted-foreground truncate">{a.reasoning}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
                      {formatDistanceToNow(new Date(a.created_at), { addSuffix: true, locale: es })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── Autopilot Snapshot (on-demand) ─── */}
        {snapshot ? (
          <>
            <Separator />

            {/* Sync Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricBox label="Monitoreados" value={health!.sync.total_monitored} />
              <MetricBox label="Sincronizados hoy" value={health!.sync.synced_today} />
              <MetricBox label="Fallos hoy" value={health!.sync.failures_today} variant="destructive" />
              <MetricBox label="Scraping pendiente" value={health!.sync.scraping_pending_today} variant="warning" />
              <MetricBox label="Omitidos" value={health!.sync.skipped_today} />
              <MetricBox
                label="Transient sin retry"
                value={health!.sync.transient_without_retry}
                variant={health!.sync.transient_without_retry > 0 ? "destructive" : undefined}
              />
              <MetricBox
                label={`Vacíos 24h (${health!.sync.empty_result_rate}%)`}
                value={health!.sync.empty_result_count}
                variant={health!.sync.empty_result_rate > 20 ? "warning" : undefined}
              />
            </div>

            <Separator />

            {/* Retry Queue */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                Cola de Reintentos
              </h4>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Pendientes:</span>{" "}
                  <span className="font-semibold">{health!.retry_queue.pending_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Vencidos:</span>{" "}
                  <span className="font-semibold text-amber-600">{health!.retry_queue.due_count}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Más antiguo:</span>{" "}
                  <span className="font-semibold">
                    {health!.retry_queue.oldest_due_at
                      ? formatDistanceToNow(new Date(health!.retry_queue.oldest_due_at), {
                          addSuffix: true,
                          locale: es,
                        })
                      : "—"}
                  </span>
                </div>
              </div>
              {Object.keys(health!.retry_queue.by_kind).length > 0 && (
                <div className="flex gap-2 mt-1.5">
                  {Object.entries(health!.retry_queue.by_kind).map(([kind, count]) => (
                    <Badge key={kind} variant="outline" className="text-[10px]">
                      {kind}: {count}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Demonitor Gates */}
            <div>
              <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Demonitoreo (Safety Gates)
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Elegibles:</span>{" "}
                  <span className="font-semibold">{health!.demonitors.eligible_count}</span>
                </div>
                <div>
                  <Badge variant="outline" className="text-[10px] mr-1">PENDING_RETRY</Badge>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.PENDING_RETRY || 0}</span>
                </div>
                <div>
                  <Badge variant="outline" className="text-[10px] mr-1">TRANSIENT_ERROR</Badge>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.TRANSIENT_ERROR || 0}</span>
                </div>
                <div>
                  <Badge variant="outline" className="text-[10px] mr-1">RECENTLY_HEALTHY</Badge>
                  <span className="font-semibold">{health!.demonitors.blocked_breakdown.RECENTLY_HEALTHY || 0}</span>
                </div>
              </div>
            </div>

            {/* Invariant Violations */}
            {violations.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5 text-destructive">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Violaciones de Invariantes ({violations.length})
                  </h4>
                  <div className="space-y-2">
                    {violations.map((v, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs border rounded p-2">
                        {v.severity === "CRITICAL" ? (
                          <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              variant={v.severity === "CRITICAL" ? "destructive" : "secondary"}
                              className="text-[10px]"
                            >
                              {v.code}
                            </Badge>
                            {v.radicado && (
                              <span className="text-muted-foreground">{v.radicado}</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-muted-foreground">{v.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Actions Taken */}
            {actionsTaken.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-medium mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    Acciones Ejecutadas ({actionsTaken.length})
                  </h4>
                  <div className="space-y-1">
                    {actionsTaken.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {a.type}
                        </Badge>
                        {a.radicado && <span className="text-muted-foreground">{a.radicado}</span>}
                        <span className="text-muted-foreground">— {a.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {violations.length === 0 && actionsTaken.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-green-600">
                <CheckCircle2 className="h-4 w-4" />
                Todas las invariantes verificadas. Sin violaciones ni acciones correctivas.
              </div>
            )}

            <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-1">
              <Clock className="h-3 w-3" />
              Snapshot: {snapshot.now} · {snapshot.duration_ms}ms
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground pt-2">
            Ejecuta <strong>Autopilot</strong> para obtener snapshot de invariantes, retries y demonitoreo.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "destructive" | "warning";
}) {
  const colorClass =
    variant === "destructive"
      ? "text-destructive"
      : variant === "warning"
        ? "text-amber-600"
        : "";

  return (
    <div>
      <div className={`text-lg font-bold ${colorClass}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
