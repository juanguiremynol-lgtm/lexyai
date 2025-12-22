import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ExternalLink,
  List,
  FileText,
  LogIn,
  Play,
  XCircle,
  Zap,
  Settings,
  AlertTriangle,
  ChevronDown,
  Activity,
  Key
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { es } from "date-fns/locale";

interface EdgeFunctionError {
  code?: string;
  message?: string;
  status?: number;
  ok?: boolean;
  timestamp?: string;
}

function parseEdgeFunctionError(data: any, error: any): EdgeFunctionError {
  if (data && typeof data === 'object' && data.ok === false) {
    return {
      code: data.code || 'UNKNOWN',
      message: data.message || data.error || 'Unknown error',
      ok: false,
      timestamp: data.timestamp,
    };
  }
  
  if (error) {
    return {
      code: 'INVOKE_ERROR',
      message: error.message || String(error),
      ok: false,
    };
  }
  
  return { code: 'UNKNOWN', message: 'Unknown error', ok: false };
}

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

const CLASSIFICATION_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  SUCCESS: { label: 'Éxito', variant: 'default' },
  PARTIAL: { label: 'Parcial', variant: 'secondary' },
  AUTH_FAILED: { label: 'Auth Fallida', variant: 'destructive' },
  NEEDS_REAUTH: { label: 'Requiere Login', variant: 'destructive' },
  CAPTCHA_REQUIRED: { label: 'CAPTCHA', variant: 'destructive' },
  RATE_LIMITED: { label: 'Rate Limited', variant: 'secondary' },
  PARSE_BROKE: { label: 'Parse Error', variant: 'destructive' },
  JSF_AJAX_NOT_REPLAYED: { label: 'JSF No Replicado', variant: 'destructive' },
  NETWORK_ERROR: { label: 'Error Red', variant: 'destructive' },
  UNKNOWN: { label: 'Desconocido', variant: 'outline' },
};

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  CONNECTED: { label: 'Conectado', variant: 'default' },
  PENDING: { label: 'Pendiente', variant: 'secondary' },
  NEEDS_REAUTH: { label: 'Requiere Login', variant: 'destructive' },
  AUTH_FAILED: { label: 'Auth Fallida', variant: 'destructive' },
  CAPTCHA_REQUIRED: { label: 'CAPTCHA', variant: 'destructive' },
  ERROR: { label: 'Error', variant: 'destructive' },
};

export default function IcarusTest() {
  const [searchParams] = useSearchParams();
  const runIdParam = searchParams.get("run");
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<any>(null);

  // Check integration status
  const { data: integration, isLoading: loadingIntegration, refetch: refetchIntegration } = useQuery({
    queryKey: ["icarus-integration-test"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("owner_id", user.id)
        .eq("provider", "ICARUS")
        .maybeSingle();
      return data;
    },
  });

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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("icarus_sync_runs")
        .select("*")
        .eq("owner_id", user.id)
        .order("started_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });

  const [lastError, setLastError] = useState<EdgeFunctionError | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [healthResult, setHealthResult] = useState<any>(null);

  // Health check
  const checkHealth = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-health");
      if (error) {
        const parsed = parseEdgeFunctionError(data, error);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      setHealthResult(data);
      return data;
    },
  });

  // Test login action (refreshes session using stored credentials)
  const testLogin = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-auth", {
        body: { action: "refresh" },
      });
      if (error) {
        const parsed = parseEdgeFunctionError(data, error);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      return data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      queryClient.invalidateQueries({ queryKey: ["icarus-integration-test"] });
      refetchRuns();
    },
  });

  // Test list action
  const testList = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("adapter-icarus", {
        body: { action: "list" },
      });
      if (error) {
        const parsed = parseEdgeFunctionError(data, error);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      return data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      refetchRuns();
      refetchIntegration();
    },
  });

  // Full sync
  const runSync = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-sync", {
        body: { mode: "manual", fullSync: true },
      });
      if (error) {
        const parsed = parseEdgeFunctionError(data, error);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null);
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      return data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      queryClient.invalidateQueries({ queryKey: ["icarus-integration-test"] });
      refetchRuns();
    },
  });

  const displayRun = syncRun || (recentRuns && recentRuns[0]);
  const steps = (Array.isArray(displayRun?.steps) ? displayRun.steps : []) as unknown as Step[];
  const attempts = (Array.isArray(displayRun?.attempts) ? displayRun.attempts : Array.isArray(testResult?.attempts) ? testResult.attempts : []) as unknown as AttemptLog[];

  const getClassificationBadge = (cls: string | null) => {
    const config = CLASSIFICATION_LABELS[cls || 'UNKNOWN'] || CLASSIFICATION_LABELS.UNKNOWN;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusBadge = (status: string | null) => {
    const config = STATUS_LABELS[status || ''] || { label: status || 'Desconocido', variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const isConnected = integration?.status === 'CONNECTED';
  const hasCredentials = integration?.username && integration?.password_encrypted;
  const hasSession = !!integration?.session_encrypted;
  const isPending = testLogin.isPending || testList.isPending || runSync.isPending;

  // Determine integration state for UI
  const getIntegrationState = () => {
    if (!integration) return 'NOT_CONFIGURED';
    if (!hasCredentials) return 'MISSING_CREDENTIALS';
    if (isConnected) return 'READY';
    if (hasSession) return 'SESSION_EXISTS';
    return 'CREDENTIALS_ONLY';
  };

  const integrationState = getIntegrationState();

  if (loadingIntegration) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold">ICARUS - Test Harness</h1>
        <p className="text-muted-foreground">
          Prueba y diagnóstico de la integración ICARUS
        </p>
      </div>

      {/* Integration Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            Estado de Integración
            {isConnected ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : hasCredentials ? (
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            ) : (
              <XCircle className="h-4 w-4 text-destructive" />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {integration ? getStatusBadge(integration.status) : (
              <Badge variant="outline">NO CONFIGURADO</Badge>
            )}
            
            {integration?.username && (
              <span className="text-sm text-muted-foreground">
                Usuario: {integration.username}
              </span>
            )}
            
            {integration?.session_last_ok_at && (
              <span className="text-sm text-muted-foreground">
                Sesión OK: {formatDistanceToNow(new Date(integration.session_last_ok_at), { addSuffix: true, locale: es })}
              </span>
            )}
          </div>

          {/* Diagnostic info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-muted-foreground">Credenciales guardadas:</p>
              <Badge variant={hasCredentials ? "default" : "destructive"}>
                {hasCredentials ? "Sí" : "No"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">Sesión almacenada:</p>
              <Badge variant={hasSession ? "default" : "secondary"}>
                {hasSession ? "Sí" : "No"}
              </Badge>
            </div>
          </div>

          {/* CTA if not configured */}
          {integrationState === 'NOT_CONFIGURED' && (
            <Alert>
              <Settings className="h-4 w-4" />
              <AlertTitle>Integración no configurada</AlertTitle>
              <AlertDescription className="flex items-center gap-2">
                Configura tus credenciales ICARUS en Configuración.
                <Link to="/settings" className="text-primary hover:underline inline-flex items-center gap-1">
                  <Settings className="h-3 w-3" />
                  Ir a Configuración
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {integrationState === 'MISSING_CREDENTIALS' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Credenciales incompletas</AlertTitle>
              <AlertDescription className="flex items-center gap-2">
                La integración existe pero faltan las credenciales encriptadas.
                <Link to="/settings" className="text-primary hover:underline inline-flex items-center gap-1">
                  <Settings className="h-3 w-3" />
                  Reconfigurar
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {integration?.last_error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{integration.last_error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Test Actions */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          onClick={() => testLogin.mutate()}
          disabled={isPending || !hasCredentials}
          title={!hasCredentials ? "Requiere credenciales guardadas" : "Probar login con credenciales almacenadas"}
        >
          {testLogin.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4 mr-2" />
          )}
          Test Login
        </Button>
        <Button
          variant="outline"
          onClick={() => testList.mutate()}
          disabled={isPending || !hasCredentials}
          title={!hasCredentials ? "Requiere credenciales guardadas" : "Listar procesos desde ICARUS"}
        >
          {testList.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <List className="h-4 w-4 mr-2" />
          )}
          Listar Procesos
        </Button>
        <Button
          onClick={() => runSync.mutate()}
          disabled={isPending || !hasCredentials}
          title={!hasCredentials ? "Requiere credenciales guardadas" : "Sincronización completa"}
        >
          {runSync.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 mr-2" />
          )}
          Sincronización Completa
        </Button>

        {!hasCredentials && (
          <Link to="/settings">
            <Button variant="secondary">
              <Settings className="h-4 w-4 mr-2" />
              Configurar Credenciales
            </Button>
          </Link>
        )}
      </div>

      {/* Test Result */}
      {testResult && (
        <Alert variant={testResult.ok ? "default" : "destructive"}>
          {testResult.ok ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertTitle>
            {testResult.ok ? "Éxito" : "Error"} - {testResult.classification || testResult.status || 'N/A'}
          </AlertTitle>
          <AlertDescription>
            {testResult.ok
              ? `Procesos: ${testResult.processes?.length || testResult.processes_found || 0}, Eventos: ${testResult.events_created || 0}`
              : testResult.error}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="run" className="space-y-4">
        <TabsList>
          <TabsTrigger value="run">
            <FileText className="h-4 w-4 mr-1" />
            Última Ejecución
          </TabsTrigger>
          <TabsTrigger value="attempts">
            <Play className="h-4 w-4 mr-1" />
            Intentos ({attempts.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="h-4 w-4 mr-1" />
            Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          {displayRun ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Run: {displayRun.id?.slice(0, 8)}
                  {getClassificationBadge(displayRun.classification)}
                </CardTitle>
                <CardDescription>
                  {format(new Date(displayRun.started_at), "PPpp", { locale: es })}
                  {displayRun.finished_at && (
                    <span className="ml-2">
                      (duración: {Math.round((new Date(displayRun.finished_at).getTime() - new Date(displayRun.started_at).getTime()) / 1000)}s)
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 flex-wrap">
                  <Badge variant={displayRun.status === "SUCCESS" ? "default" : displayRun.status === "RUNNING" ? "secondary" : "destructive"}>
                    {displayRun.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {displayRun.processes_found ?? 0} procesos • {displayRun.events_created ?? 0} eventos
                  </span>
                </div>

                {displayRun.error_message && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{displayRun.error_message}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <h4 className="font-medium">Pasos de Ejecución</h4>
                  <div className="space-y-1">
                    {steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 bg-muted rounded text-sm">
                        {step.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                        ) : step.status === "error" ? (
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground shrink-0 animate-pulse" />
                        )}
                        <span className="font-mono text-xs">{step.name}</span>
                        {step.detail && (
                          <span className="text-muted-foreground text-xs">— {step.detail}</span>
                        )}
                        {step.started_at && step.finished_at && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            {Math.round((new Date(step.finished_at).getTime() - new Date(step.started_at).getTime()))}ms
                          </span>
                        )}
                      </div>
                    ))}
                    {steps.length === 0 && (
                      <p className="text-sm text-muted-foreground">No hay pasos registrados</p>
                    )}
                  </div>
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
              <CardTitle>Log de Intentos HTTP</CardTitle>
              <CardDescription>
                Cada intento muestra fase, URL, status, latencia y snippet de respuesta
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {attempts.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">
                      No hay intentos registrados. Ejecuta una prueba.
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
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                            <Badge variant="secondary" className="text-xs">
                              {attempt.error_type}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-mono break-all text-muted-foreground">
                          {attempt.method} {attempt.url}
                        </p>
                        {attempt.response_snippet && (
                          <pre className="text-xs mt-2 p-2 bg-muted rounded overflow-x-auto max-h-32 whitespace-pre-wrap">
                            {attempt.response_snippet}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Historial de Ejecuciones</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {recentRuns?.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">
                      No hay historial
                    </p>
                  )}
                  {recentRuns?.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between p-3 bg-muted rounded hover:bg-muted/80 cursor-pointer transition-colors"
                      onClick={() => window.location.href = `/process-status/test-icarus?run=${run.id}`}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant={run.status === "SUCCESS" ? "default" : run.status === "RUNNING" ? "secondary" : "destructive"}>
                          {run.status}
                        </Badge>
                        {run.classification && getClassificationBadge(run.classification)}
                        <span className="text-sm">
                          {run.processes_found ?? 0} proc • {run.events_created ?? 0} evt
                        </span>
                        {run.mode && (
                          <Badge variant="outline" className="text-xs">{run.mode}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(run.started_at), { addSuffix: true, locale: es })}
                        <ExternalLink className="h-3 w-3" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
