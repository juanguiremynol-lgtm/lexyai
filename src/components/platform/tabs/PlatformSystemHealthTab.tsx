/**
 * Platform System Health Tab - Global system monitoring
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Server, Clock, CheckCircle2, XCircle, AlertTriangle, RefreshCw, CalendarClock } from "lucide-react";
import { format, subHours, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface JobRun {
  id: string;
  job_name: string;
  status: string;
  organization_id?: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  processed_count: number | null;
  error: string | null;
  metadata?: Record<string, unknown>;
}

interface HealthEvent {
  id: string;
  service: string;
  status: string;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function PlatformSystemHealthTab() {
  const { data: jobRuns, isLoading: jobsLoading } = useQuery({
    queryKey: ["platform-job-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as JobRun[];
    },
  });

  const { data: healthEvents, isLoading: healthLoading } = useQuery({
    queryKey: ["platform-health-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_health_events")
        .select("*")
        .gte("created_at", subHours(new Date(), 24).toISOString())
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      return data as HealthEvent[];
    },
  });

  // Get scheduled-daily-sync specific data
  const lastDailySync = jobRuns?.find(j => j.job_name === 'scheduled-daily-sync');
  const dailySyncRuns = jobRuns?.filter(j => j.job_name === 'scheduled-daily-sync') || [];

  const getStatusIcon = (status: string) => {
    switch (status.toUpperCase()) {
      case "OK":
      case "COMPLETED":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "ERROR":
      case "FAILED":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "RUNNING":
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
      case "PARTIAL":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status.toUpperCase()) {
      case "OK":
      case "COMPLETED":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{status}</Badge>;
      case "ERROR":
      case "FAILED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{status}</Badge>;
      case "RUNNING":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">{status}</Badge>;
      case "PARTIAL":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">{status}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Stats
  const jobStats = {
    total: jobRuns?.length || 0,
    ok: jobRuns?.filter((j) => j.status === "OK" || j.status === "COMPLETED").length || 0,
    failed: jobRuns?.filter((j) => j.status === "ERROR" || j.status === "FAILED").length || 0,
    running: jobRuns?.filter((j) => j.status === "RUNNING").length || 0,
  };

  const healthStats = {
    total: healthEvents?.length || 0,
    ok: healthEvents?.filter((e) => e.status === "OK").length || 0,
    error: healthEvents?.filter((e) => e.status === "ERROR").length || 0,
  };

  const isLoading = jobsLoading || healthLoading;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cargando datos del sistema...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <div>
                <div className="text-2xl font-bold">{jobStats.total}</div>
                <p className="text-sm text-muted-foreground">Jobs Totales</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{jobStats.ok}</div>
                <p className="text-sm text-muted-foreground">Exitosos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <div>
                <div className="text-2xl font-bold">{jobStats.failed}</div>
                <p className="text-sm text-muted-foreground">Fallidos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-blue-500" />
              <div>
                <div className="text-2xl font-bold">{jobStats.running}</div>
                <p className="text-sm text-muted-foreground">En Ejecución</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scheduled Daily Sync Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Sincronización Diaria Automática
          </CardTitle>
          <CardDescription>
            Ejecuta a las 7:00 AM COT (12:00 UTC) - Sincroniza todos los work items con monitoreo activo
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lastDailySync ? (
            <div className="space-y-4">
              {/* Last run summary */}
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  {getStatusIcon(lastDailySync.status)}
                  <div>
                    <div className="font-medium">Última ejecución</div>
                    <div className="text-sm text-muted-foreground">
                      {format(new Date(lastDailySync.started_at), "dd MMM yyyy HH:mm", { locale: es })}
                      {" · "}
                      {formatDistanceToNow(new Date(lastDailySync.started_at), { addSuffix: true, locale: es })}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {getStatusBadge(lastDailySync.status)}
                </div>
              </div>

              {/* Stats from metadata */}
              {lastDailySync.metadata && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl font-bold text-primary">
                      {(lastDailySync.metadata as any).success_count ?? lastDailySync.processed_count ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Exitosos</div>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl font-bold text-amber-500">
                      {(lastDailySync.metadata as any).scraping_initiated ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Scraping Iniciado</div>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-500">
                      {(lastDailySync.metadata as any).error_count ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Errores</div>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <div className="text-2xl font-bold">
                      {lastDailySync.duration_ms ? `${Math.round(lastDailySync.duration_ms / 1000)}s` : '-'}
                    </div>
                    <div className="text-xs text-muted-foreground">Duración</div>
                  </div>
                </div>
              )}

              {/* Error details if any */}
              {(lastDailySync.metadata as any)?.errors?.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2 text-red-500">Errores recientes:</h4>
                  <div className="max-h-32 overflow-y-auto space-y-1 text-xs">
                    {((lastDailySync.metadata as any).errors as any[]).slice(0, 5).map((err: any, i: number) => (
                      <div key={i} className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
                        <span className="font-mono">{err.radicado || err.work_item_id}</span>: {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent runs history */}
              {dailySyncRuns.length > 1 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">Historial reciente:</h4>
                  <div className="space-y-1">
                    {dailySyncRuns.slice(0, 5).map((run) => (
                      <div key={run.id} className="flex items-center justify-between p-2 border rounded text-sm">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          <span>{format(new Date(run.started_at), "dd MMM HH:mm", { locale: es })}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {run.processed_count ?? 0} procesados
                          </span>
                          {getStatusBadge(run.status)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay ejecuciones registradas de la sincronización diaria</p>
              <p className="text-xs mt-1">El cron job ejecuta a las 7:00 AM COT</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Runs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Jobs Recientes
          </CardTitle>
          <CardDescription>
            Ejecuciones de trabajos programados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {jobRuns?.map((job) => (
              <div
                key={job.id}
                className="p-3 border rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(job.status)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{job.job_name}</span>
                      {getStatusBadge(job.status)}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {job.duration_ms && <span>{job.duration_ms}ms</span>}
                      {job.processed_count !== null && (
                        <span>• {job.processed_count} procesados</span>
                      )}
                      {job.error && (
                        <span className="text-red-500 truncate max-w-[200px]">
                          • {job.error}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(job.started_at), "dd MMM HH:mm", { locale: es })}
                </span>
              </div>
            ))}

            {(!jobRuns || jobRuns.length === 0) && (
              <p className="text-center text-muted-foreground py-4">
                No hay jobs registrados
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Health Events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Eventos de Salud (Últimas 24h)
          </CardTitle>
          <CardDescription>
            {healthStats.ok} OK, {healthStats.error} errores
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {healthEvents?.map((event) => (
              <div
                key={event.id}
                className="p-3 border rounded-lg flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(event.status)}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{event.service}</span>
                      {getStatusBadge(event.status)}
                    </div>
                    {event.message && (
                      <p className="text-xs text-muted-foreground truncate max-w-[400px]">
                        {event.message}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(event.created_at), "HH:mm:ss", { locale: es })}
                </span>
              </div>
            ))}

            {(!healthEvents || healthEvents.length === 0) && (
              <p className="text-center text-muted-foreground py-4">
                No hay eventos de salud en las últimas 24 horas
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
