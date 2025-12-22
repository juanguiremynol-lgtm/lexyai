import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ExternalLink,
  List,
  FileText
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";

interface AttemptLog {
  phase: string;
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: string;
  response_snippet?: string;
  success: boolean;
}

interface Step {
  name: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
}

export default function IcarusTest() {
  const [searchParams] = useSearchParams();
  const runIdParam = searchParams.get("run");
  const [testResult, setTestResult] = useState<any>(null);

  // Fetch specific run if provided
  const { data: syncRun, isLoading: loadingRun } = useQuery({
    queryKey: ["icarus-sync-run", runIdParam],
    queryFn: async () => {
      if (!runIdParam) return null;
      const { data, error } = await supabase
        .from("icarus_sync_runs")
        .select("*")
        .eq("id", runIdParam)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!runIdParam,
  });

  // Fetch recent runs
  const { data: recentRuns, refetch: refetchRuns } = useQuery({
    queryKey: ["icarus-recent-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("icarus_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const testList = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("adapter-icarus", {
        body: { action: "list" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setTestResult(data);
    },
  });

  const runSync = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("icarus-sync", {
        body: { mode: "manual", fullSync: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      refetchRuns();
    },
  });

  const displayRun = syncRun || (recentRuns && recentRuns[0]);
  const steps = (Array.isArray(displayRun?.steps) ? displayRun.steps : []) as Step[];
  const attempts = (Array.isArray(displayRun?.attempts) ? displayRun.attempts : Array.isArray(testResult?.attempts) ? testResult.attempts : []) as AttemptLog[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">ICARUS - Test Harness</h1>
        <p className="text-muted-foreground">
          Prueba y diagnóstico de la integración ICARUS
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => testList.mutate()}
          disabled={testList.isPending}
        >
          {testList.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <List className="h-4 w-4 mr-2" />
          )}
          Listar Procesos
        </Button>
        <Button
          variant="outline"
          onClick={() => runSync.mutate()}
          disabled={runSync.isPending}
        >
          {runSync.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sincronización Completa
        </Button>
      </div>

      {testResult && (
        <Alert variant={testResult.ok ? "default" : "destructive"}>
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>
            {testResult.ok
              ? `Encontrados ${testResult.processes?.length || 0} procesos`
              : testResult.error}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="run" className="space-y-4">
        <TabsList>
          <TabsTrigger value="run">Última Ejecución</TabsTrigger>
          <TabsTrigger value="attempts">Intentos ({attempts.length})</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          {displayRun ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Run: {displayRun.id?.slice(0, 8)}
                </CardTitle>
                <CardDescription>
                  {format(new Date(displayRun.started_at), "PPpp", { locale: es })}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <Badge variant={displayRun.status === "SUCCESS" ? "default" : "destructive"}>
                    {displayRun.status}
                  </Badge>
                  {displayRun.classification && (
                    <Badge variant="outline">{displayRun.classification}</Badge>
                  )}
                  <span className="text-sm text-muted-foreground">
                    {displayRun.processes_found} procesos, {displayRun.events_created} eventos nuevos
                  </span>
                </div>

                {displayRun.error_message && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{displayRun.error_message}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <h4 className="font-medium">Pasos</h4>
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded text-sm">
                      {step.status === "success" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : step.status === "error" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-mono">{step.name}</span>
                      {step.detail && (
                        <span className="text-muted-foreground">- {step.detail}</span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No hay ejecuciones recientes
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="attempts">
          <Card>
            <CardHeader>
              <CardTitle>Log de Intentos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {attempts.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">
                    No hay intentos registrados
                  </p>
                ) : (
                  attempts.map((attempt, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded border ${
                        attempt.success
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-destructive/30 bg-destructive/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="font-mono text-xs">
                          {attempt.phase}
                        </Badge>
                        <Badge variant={attempt.success ? "default" : "destructive"}>
                          {attempt.status ?? "ERR"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {attempt.latency_ms}ms
                        </span>
                        {attempt.error_type && (
                          <Badge variant="outline" className="text-xs">
                            {attempt.error_type}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs font-mono break-all text-muted-foreground">
                        {attempt.method} {attempt.url}
                      </p>
                      {attempt.response_snippet && (
                        <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-x-auto max-h-24">
                          {attempt.response_snippet}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Ejecuciones</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentRuns?.map((run) => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between p-3 bg-muted rounded hover:bg-muted/80 cursor-pointer"
                    onClick={() => window.location.href = `/process-status/test-icarus?run=${run.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={run.status === "SUCCESS" ? "default" : "destructive"}>
                        {run.status}
                      </Badge>
                      <span className="text-sm">
                        {run.processes_found} procesos, {run.events_created} eventos
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(run.started_at), { addSuffix: true, locale: es })}
                      <ExternalLink className="h-3 w-3" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}