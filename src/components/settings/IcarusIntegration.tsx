import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Cloud, 
  CloudOff, 
  RefreshCw, 
  Unlink, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  LogIn,
  ChevronDown
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { Link } from "react-router-dom";
import { IcarusExcelImport, IcarusImportHistory } from "@/components/icarus-import";

interface EdgeFunctionError {
  code?: string;
  message?: string;
  status?: number;
  ok?: boolean;
  timestamp?: string;
  functionName?: string;
  body?: string;
}

function parseEdgeFunctionError(data: any, error: any, functionName?: string): EdgeFunctionError {
  const result: EdgeFunctionError = {
    code: 'UNKNOWN',
    message: 'Unknown error',
    ok: false,
    functionName,
  };

  // Try to extract structured error from response
  if (data && typeof data === 'object' && data.ok === false) {
    result.code = data.code || 'UNKNOWN';
    result.message = data.message || data.error || 'Unknown error';
    result.timestamp = data.timestamp;
    return result;
  }
  
  // Supabase functions.invoke error - check context for real error
  if (error) {
    result.code = error.code || 'INVOKE_ERROR';
    result.message = error.message || String(error);
    
    // Extract context if available (contains HTTP status and body)
    if (error.context) {
      result.status = error.context.status;
      try {
        const body = error.context.body;
        if (body) {
          result.body = typeof body === 'string' ? body : JSON.stringify(body);
          // Try to parse body for structured error
          const parsed = typeof body === 'string' ? JSON.parse(body) : body;
          if (parsed.code) result.code = parsed.code;
          if (parsed.message) result.message = parsed.message;
          if (parsed.timestamp) result.timestamp = parsed.timestamp;
        }
      } catch {
        // Body wasn't JSON, keep as string
      }
    }
    return result;
  }
  
  return result;
}

export function IcarusIntegration() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [lastError, setLastError] = useState<EdgeFunctionError | null>(null);
  const [showErrorDetails, setShowErrorDetails] = useState(false);

  const { data: integration, isLoading, refetch } = useQuery({
    queryKey: ["icarus-integration"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("owner_id", user.id)
        .eq("provider", "ICARUS")
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });

  const { data: lastSyncRun } = useQuery({
    queryKey: ["icarus-last-sync"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("icarus_sync_runs")
        .select("*")
        .eq("owner_id", user.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });

  // Step 1: Save credentials (encrypts and stores)
  const saveCredentials = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-save-credentials", {
        body: { username, password },
      });
      
      if (error) {
        const parsed = parseEdgeFunctionError(data, error, 'icarus-save-credentials');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null, 'icarus-save-credentials');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      return data;
    },
    onSuccess: () => {
      toast.success("Credenciales guardadas");
      refetch();
    },
    onError: (error) => {
      toast.error("Error al guardar: " + error.message);
    },
  });

  // Step 2: Test login (uses stored credentials to create session)
  const testLogin = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-auth", {
        body: { action: "refresh" },
      });
      
      if (error) {
        const parsed = parseEdgeFunctionError(data, error, 'icarus-auth');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null, 'icarus-auth');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      toast.success("Login exitoso - Estado: " + data.status);
    },
    onError: (error) => {
      toast.error("Error de login: " + error.message);
    },
  });

  // Combined: Save and test
  const saveAndTest = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      setLastError(null);
      
      // First save credentials
      const saveResult = await supabase.functions.invoke("icarus-save-credentials", {
        body: { username, password },
      });
      
      if (saveResult.error) {
        const parsed = parseEdgeFunctionError(saveResult.data, saveResult.error, 'icarus-save-credentials');
        setLastError(parsed);
        throw new Error(`Save failed: ${parsed.message}`);
      }
      
      if (saveResult.data && !saveResult.data.ok) {
        const parsed = parseEdgeFunctionError(saveResult.data, null, 'icarus-save-credentials');
        setLastError(parsed);
        throw new Error(`Save failed: ${parsed.message}`);
      }

      // Then test login
      const loginResult = await supabase.functions.invoke("icarus-auth", {
        body: { action: "refresh" },
      });
      
      if (loginResult.error) {
        const parsed = parseEdgeFunctionError(loginResult.data, loginResult.error, 'icarus-auth');
        setLastError(parsed);
        throw new Error(`Login failed: ${parsed.message}`);
      }
      
      if (loginResult.data && !loginResult.data.ok) {
        const parsed = parseEdgeFunctionError(loginResult.data, null, 'icarus-auth');
        setLastError(parsed);
        throw new Error(`Login failed: ${parsed.message}`);
      }
      
      return loginResult.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-last-sync"] });
      setUsername("");
      setPassword("");
      setLastError(null);
      toast.success("Conexión ICARUS exitosa");
    },
    onError: (error) => {
      refetch(); // Refetch to show current state
      toast.error("Error: " + error.message);
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("owner_id", user.id)
        .eq("provider", "ICARUS");
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-last-sync"] });
      setLastError(null);
      toast.success("Integración ICARUS desconectada");
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const syncNow = useMutation({
    mutationFn: async () => {
      setLastError(null);
      const { data, error } = await supabase.functions.invoke("icarus-sync", {
        body: { mode: "manual", fullSync: true },
      });
      
      if (error) {
        const parsed = parseEdgeFunctionError(data, error, 'icarus-sync');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      if (data && !data.ok) {
        const parsed = parseEdgeFunctionError(data, null, 'icarus-sync');
        setLastError(parsed);
        throw new Error(parsed.message);
      }
      
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["icarus-integration"] });
      queryClient.invalidateQueries({ queryKey: ["icarus-last-sync"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      toast.success(`Sincronización: ${data.processes_found || 0} procesos, ${data.events_created || 0} eventos nuevos`);
    },
    onError: (error) => {
      toast.error("Error: " + error.message);
    },
  });

  const isConnected = integration?.status === "CONNECTED";
  const hasCredentials = integration?.username && integration?.password_encrypted;
  const needsReauth = integration?.status === "NEEDS_REAUTH" || integration?.status === "AUTH_FAILED";
  const isPending = saveAndTest.isPending || syncNow.isPending || testLogin.isPending || saveCredentials.isPending;

  const getStatusBadge = () => {
    if (isConnected) {
      return (
        <Badge className="bg-green-500/20 text-green-700 border-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Conectado
        </Badge>
      );
    }
    if (needsReauth) {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          Requiere reconexión
        </Badge>
      );
    }
    if (integration?.status === "CAPTCHA_REQUIRED") {
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" />
          CAPTCHA detectado
        </Badge>
      );
    }
    if (integration?.status === "PENDING") {
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          Pendiente de verificación
        </Badge>
      );
    }
    if (hasCredentials) {
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          Credenciales guardadas
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        <CloudOff className="h-3 w-3 mr-1" />
        No configurado
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            Cargando...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isConnected ? (
            <Cloud className="h-5 w-5 text-green-500" />
          ) : (
            <CloudOff className="h-5 w-5 text-muted-foreground" />
          )}
          Integración ICARUS
        </CardTitle>
        <CardDescription>
          Sincroniza tus procesos desde ICARUS con tus credenciales de acceso
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status */}
        <div className="flex items-center gap-4 flex-wrap">
          {getStatusBadge()}
          
          {integration?.username && (
            <span className="text-sm text-muted-foreground">
              Usuario: {integration.username}
            </span>
          )}
          
          {integration?.last_sync_at && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Última sync: {formatDistanceToNow(new Date(integration.last_sync_at), { 
                addSuffix: true, 
                locale: es 
              })}
            </span>
          )}

          <Link 
            to="/process-status/test-icarus" 
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            Test Harness
          </Link>
        </div>

        {/* Error Display with Details */}
        {(integration?.last_error || lastError) && (
          <Collapsible open={showErrorDetails} onOpenChange={setShowErrorDetails}>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="flex items-center gap-2">
                Error
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-6 px-2">
                    <ChevronDown className={`h-3 w-3 transition-transform ${showErrorDetails ? 'rotate-180' : ''}`} />
                    Detalles
                  </Button>
                </CollapsibleTrigger>
              </AlertTitle>
              <AlertDescription>
                {lastError?.message || integration?.last_error}
              </AlertDescription>
              <CollapsibleContent className="mt-2">
                <div className="bg-background/50 rounded p-2 text-xs font-mono space-y-1">
                  {lastError?.functionName && <div><strong>Function:</strong> {lastError.functionName}</div>}
                  {lastError?.code && <div><strong>Código:</strong> {lastError.code}</div>}
                  {lastError?.status && <div><strong>HTTP Status:</strong> {lastError.status}</div>}
                  {lastError?.timestamp && <div><strong>Timestamp:</strong> {lastError.timestamp}</div>}
                  {lastError?.body && (
                    <div>
                      <strong>Response Body:</strong>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] max-h-32 overflow-auto">
                        {lastError.body}
                      </pre>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Alert>
          </Collapsible>
        )}

        {/* Last Sync Run Info */}
        {lastSyncRun && (
          <div className="p-3 bg-muted rounded-lg text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span>
                Último resultado: <strong>{lastSyncRun.classification || lastSyncRun.status}</strong>
                {lastSyncRun.processes_found !== null && ` — ${lastSyncRun.processes_found} procesos`}
                {lastSyncRun.events_created !== null && `, ${lastSyncRun.events_created} eventos nuevos`}
              </span>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => window.open(`/process-status/test-icarus?run=${lastSyncRun.id}`, '_blank')}
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                Diagnóstico
              </Button>
            </div>
          </div>
        )}

        {/* Login Form - show if not connected or needs reauth */}
        {(!isConnected || needsReauth || !hasCredentials) && (
          <div className="space-y-4 border rounded-lg p-4">
            <div className="space-y-2">
              <Label htmlFor="icarus-username">Usuario ICARUS (email)</Label>
              <Input
                id="icarus-username"
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="usuario@ejemplo.com"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="icarus-password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="icarus-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => saveAndTest.mutate({ username, password })}
                disabled={!username || !password || isPending}
                className="flex-1"
              >
                {saveAndTest.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Guardar y Probar
              </Button>
              
              <Button
                variant="outline"
                onClick={() => saveCredentials.mutate({ username, password })}
                disabled={!username || !password || isPending}
              >
                {saveCredentials.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Solo Guardar
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Tus credenciales se almacenan encriptadas y solo se usan para sincronizar tus procesos.
            </p>
          </div>
        )}

        {/* Test Login Button - show if credentials exist but not connected */}
        {hasCredentials && !isConnected && (
          <Button
            variant="outline"
            onClick={() => testLogin.mutate()}
            disabled={isPending}
          >
            {testLogin.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4 mr-2" />
            )}
            Probar Login
          </Button>
        )}

        {/* Connected Actions */}
        {isConnected && (
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => syncNow.mutate()}
              disabled={isPending}
            >
              {syncNow.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sincronizar Ahora
            </Button>
            <Button
              variant="outline"
              onClick={() => testLogin.mutate()}
              disabled={isPending}
            >
              {testLogin.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              Probar Login
            </Button>
            <Button
              variant="outline"
              onClick={() => disconnect.mutate()}
              disabled={isPending}
            >
              <Unlink className="h-4 w-4 mr-2" />
              Desconectar
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          La sincronización automática se ejecuta diariamente a las 7:00 AM (hora Colombia).
        </p>
      </CardContent>
    </Card>

    {/* Excel Import Section */}
    <IcarusExcelImport />
    
    {/* Import History */}
    <IcarusImportHistory />
    </>
  );
}
