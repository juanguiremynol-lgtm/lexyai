/**
 * AteniaCronHealthPanel — Proof-based cron health dashboard.
 *
 * Shows:
 *   - Last OK run per job (DAILY_ENQUEUE, HEARTBEAT, WATCHDOG, PROCESS_QUEUE)
 *   - Queue backlog (pending/running/failed)
 *   - Sync coverage: monitored items attempted in last 24h (%)
 *   - "Omitted today" count
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Gauge,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

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

export function AteniaCronHealthPanel() {
  // Last run per job
  const { data: cronRuns, isLoading: loadingRuns, refetch: refetchRuns } = useQuery({
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

  // Queue backlog
  const { data: queueStats, isLoading: loadingQueue } = useQuery({
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

  // Coverage
  const { data: coverage, isLoading: loadingCoverage } = useQuery({
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

  const triggerWatchdog = async () => {
    try {
      const { error } = await supabase.functions.invoke("atenia-cron-watchdog");
      if (error) throw error;
      toast.success("Watchdog ejecutado manualmente");
      refetchRuns();
    } catch (err: any) {
      toast.error("Error: " + (err.message || "desconocido"));
    }
  };

  const isLoading = loadingRuns || loadingQueue || loadingCoverage;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Salud de Cron</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchRuns()} disabled={isLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refrescar
            </Button>
            <Button variant="default" size="sm" onClick={triggerWatchdog}>
              <Activity className="h-3.5 w-3.5 mr-1" />
              Ejecutar Watchdog
            </Button>
          </div>
        </div>
        <CardDescription>
          Prueba de ejecución, cobertura de sync y estado de cola
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Job Status Grid */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Timer className="h-4 w-4" />
            Último Run por Job
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      <p className="text-xs text-muted-foreground">Sin ejecuciones registradas</p>
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

        {/* Queue Stats */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Gauge className="h-4 w-4" />
            Cola de Remediación
          </h4>
          {loadingQueue ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { key: "PENDING", label: "Pendientes", color: "text-amber-500" },
                { key: "RUNNING", label: "Ejecutando", color: "text-blue-500" },
                { key: "DONE", label: "Completadas", color: "text-green-500" },
                { key: "FAILED", label: "Fallidas", color: "text-red-500" },
              ].map(({ key, label, color }) => (
                <div key={key} className="text-center p-3 rounded-lg border bg-card">
                  <p className={`text-2xl font-bold ${color}`}>
                    {queueStats?.[key] ?? 0}
                  </p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coverage */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-1.5">
            <Activity className="h-4 w-4" />
            Cobertura de Sync (24h)
          </h4>
          {loadingCoverage ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : coverage ? (
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-muted-foreground">
                      {coverage.attempted_24h} / {coverage.total_monitored} items con intento de sync
                    </span>
                    <span className={`text-sm font-bold ${
                      Number(coverage.coverage_pct) >= 90 ? "text-green-500" :
                      Number(coverage.coverage_pct) >= 70 ? "text-amber-500" : "text-red-500"
                    }`}>
                      {coverage.coverage_pct}%
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2.5">
                    <div
                      className={`h-2.5 rounded-full transition-all ${
                        Number(coverage.coverage_pct) >= 90 ? "bg-green-500" :
                        Number(coverage.coverage_pct) >= 70 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(Number(coverage.coverage_pct), 100)}%` }}
                    />
                  </div>
                </div>
              </div>
              {Number(coverage.missing_attempts) > 0 && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  {coverage.missing_attempts} items monitoreados sin intento de sync en 24h
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos de cobertura</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
