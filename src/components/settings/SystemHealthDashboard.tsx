import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Server,
  Database,
  Mail,
  Loader2,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  fetchHealthEvents,
  fetchHeartbeats,
  fetchJobRuns,
  KNOWN_SERVICES,
  type HealthEvent,
  type HealthHeartbeat,
  type JobRun,
  type HealthStatus,
} from "@/lib/system-health";

const STATUS_CONFIG: Record<HealthStatus, { icon: React.ReactNode; color: string; label: string }> = {
  OK: { icon: <CheckCircle2 className="h-4 w-4" />, color: "text-green-600 bg-green-100", label: "OK" },
  WARN: { icon: <AlertTriangle className="h-4 w-4" />, color: "text-amber-600 bg-amber-100", label: "Advertencia" },
  ERROR: { icon: <XCircle className="h-4 w-4" />, color: "text-red-600 bg-red-100", label: "Error" },
  UNKNOWN: { icon: <Clock className="h-4 w-4" />, color: "text-muted-foreground bg-muted", label: "Desconocido" },
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.UNKNOWN;
  return (
    <Badge variant="outline" className={`gap-1 ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nunca";
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: es });
  } catch {
    return "Fecha inválida";
  }
}

export function SystemHealthDashboard() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch heartbeats
  const { data: heartbeats = [], isLoading: heartbeatsLoading, refetch: refetchHeartbeats } = useQuery({
    queryKey: ["system-health-heartbeats"],
    queryFn: fetchHeartbeats,
    staleTime: 30000,
  });

  // Fetch recent events
  const { data: events = [], isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["system-health-events"],
    queryFn: () => fetchHealthEvents(25),
    staleTime: 30000,
  });

  // Fetch job runs
  const { data: jobRuns = [], isLoading: jobRunsLoading, refetch: refetchJobRuns } = useQuery({
    queryKey: ["system-health-job-runs"],
    queryFn: () => fetchJobRuns(25),
    staleTime: 30000,
  });

  // Run diagnostics mutation
  const runDiagnostics = useMutation({
    mutationFn: async () => {
      const results: { check: string; status: 'OK' | 'ERROR'; message: string }[] = [];

      // Check 1: Database connectivity
      try {
        const { count, error } = await supabase
          .from("profiles")
          .select("*", { count: "exact", head: true });
        if (error) throw error;
        results.push({ check: "Base de datos", status: "OK", message: `Conectado (${count} perfiles)` });
      } catch (err) {
        results.push({ check: "Base de datos", status: "ERROR", message: (err as Error).message });
      }

      // Check 2: RLS sanity
      try {
        const { data, error } = await supabase
          .from("work_items")
          .select("id")
          .limit(1);
        if (error && !error.message.includes("0 rows")) throw error;
        results.push({ check: "RLS (work_items)", status: "OK", message: "Acceso verificado" });
      } catch (err) {
        results.push({ check: "RLS (work_items)", status: "ERROR", message: (err as Error).message });
      }

      // Check 3: Edge function (whoami)
      try {
        const { data, error } = await supabase.functions.invoke("whoami");
        if (error) throw error;
        results.push({ check: "Edge Functions", status: "OK", message: "Disponible" });
      } catch (err) {
        results.push({ check: "Edge Functions", status: "ERROR", message: (err as Error).message });
      }

      return results;
    },
    onSuccess: (results) => {
      const hasErrors = results.some(r => r.status === "ERROR");
      if (hasErrors) {
        toast.error("Diagnóstico completado con errores");
      } else {
        toast.success("Todos los sistemas funcionan correctamente");
      }
    },
    onError: (error) => {
      toast.error("Error ejecutando diagnósticos: " + error.message);
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      refetchHeartbeats(),
      refetchEvents(),
      refetchJobRuns(),
    ]);
    toast.success("Datos actualizados");
  };

  const isLoading = heartbeatsLoading || eventsLoading || jobRunsLoading;

  // Calculate overall status
  const overallStatus: HealthStatus = heartbeats.some(h => h.last_status === 'ERROR')
    ? 'ERROR'
    : heartbeats.some(h => h.last_status === 'WARN')
      ? 'WARN'
      : heartbeats.length > 0
        ? 'OK'
        : 'UNKNOWN';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Estado del Sistema
            </CardTitle>
            <CardDescription>
              Monitoreo de servicios y trabajos programados
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={overallStatus} />
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">Resumen</TabsTrigger>
            <TabsTrigger value="jobs">Trabajos</TabsTrigger>
            <TabsTrigger value="events">Eventos</TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnósticos</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            {/* Heartbeats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {heartbeats.length === 0 && !heartbeatsLoading && (
                <p className="col-span-full text-muted-foreground text-sm">
                  No hay servicios registrados todavía.
                </p>
              )}
              {heartbeats.map((hb) => (
                <div
                  key={hb.service}
                  className="p-3 border rounded-lg flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm truncate">
                        {KNOWN_SERVICES[hb.service] || hb.service}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {hb.last_message || "Sin mensajes recientes"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Actualizado: {formatDate(hb.updated_at)}
                    </p>
                  </div>
                  <StatusBadge status={hb.last_status as HealthStatus} />
                </div>
              ))}
            </div>

            {/* Recent Issues */}
            {events.filter(e => e.status !== 'OK').length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-medium mb-2">Problemas Recientes</h4>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {events
                        .filter(e => e.status !== 'OK')
                        .slice(0, 10)
                        .map((event) => (
                          <div
                            key={event.id}
                            className="p-2 border rounded text-sm flex items-start gap-2"
                          >
                            <StatusBadge status={event.status as HealthStatus} />
                            <div className="min-w-0 flex-1">
                              <span className="font-medium">
                                {KNOWN_SERVICES[event.service] || event.service}
                              </span>
                              <p className="text-muted-foreground truncate">
                                {event.message || "Sin mensaje"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(event.created_at)}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="jobs" className="mt-4">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {jobRuns.length === 0 && !jobRunsLoading && (
                  <p className="text-muted-foreground text-sm">
                    No hay ejecuciones registradas.
                  </p>
                )}
                {jobRuns.map((run) => (
                  <div
                    key={run.id}
                    className="p-3 border rounded-lg flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">
                          {KNOWN_SERVICES[run.job_name] || run.job_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(run.started_at)}
                          {run.duration_ms && ` • ${run.duration_ms}ms`}
                          {run.processed_count > 0 && ` • ${run.processed_count} procesados`}
                        </p>
                        {run.error && (
                          <p className="text-xs text-destructive truncate max-w-[300px]">
                            {run.error}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={
                        run.status === 'OK' ? 'default' :
                        run.status === 'ERROR' ? 'destructive' :
                        'secondary'
                      }
                    >
                      {run.status === 'RUNNING' && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      {run.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {events.length === 0 && !eventsLoading && (
                  <p className="text-muted-foreground text-sm">
                    No hay eventos registrados.
                  </p>
                )}
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="p-3 border rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">
                        {KNOWN_SERVICES[event.service] || event.service}
                      </span>
                      <StatusBadge status={event.status as HealthStatus} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {event.message || "Sin mensaje"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(event.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="diagnostics" className="mt-4 space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium mb-2">Ejecutar Diagnósticos</h4>
              <p className="text-sm text-muted-foreground mb-4">
                Verifica la conectividad de la base de datos, políticas RLS, y funciones edge.
              </p>
              <Button
                onClick={() => runDiagnostics.mutate()}
                disabled={runDiagnostics.isPending}
              >
                {runDiagnostics.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Ejecutar Diagnósticos
              </Button>
            </div>

            {runDiagnostics.data && (
              <div className="space-y-2">
                <h4 className="font-medium">Resultados</h4>
                {runDiagnostics.data.map((result, i) => (
                  <div
                    key={i}
                    className={`p-3 border rounded-lg flex items-center justify-between ${
                      result.status === 'ERROR' ? 'border-destructive/50 bg-destructive/5' : ''
                    }`}
                  >
                    <div>
                      <p className="font-medium text-sm">{result.check}</p>
                      <p className="text-xs text-muted-foreground">{result.message}</p>
                    </div>
                    <Badge variant={result.status === 'OK' ? 'default' : 'destructive'}>
                      {result.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
