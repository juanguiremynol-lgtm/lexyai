/**
 * API Debug Page - Rewired for Edge Function Proxying
 * 
 * Uses Edge Functions (integration-health, debug-external-provider) 
 * to test external providers. NO direct Cloud Run calls.
 * 
 * Access: Platform Admin or Org Admin only
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Bug,
  Copy,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Shield,
  Database,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============== Types ==============

type ProviderName = "cpnu" | "samai" | "tutelas" | "publicaciones";
type WorkflowType = "CGP" | "LABORAL" | "CPACA" | "TUTELA" | "PENAL_906";

interface IntegrationHealthResult {
  ok: boolean;
  env: Record<string, boolean>;
  reachability?: Record<string, { ok: boolean; status?: number; latencyMs?: number; error?: string }>;
  timestamp: string;
  user_role?: string;
}

interface DebugSummary {
  found: boolean;
  actuacionesCount?: number;
  estadosCount?: number;
  publicacionesCount?: number;
  hasExpediente?: boolean;
  hasDocuments?: boolean;
  despacho?: string;
  tipoProceso?: string;
}

interface ProviderAttempt {
  provider: string;
  status: 'success' | 'not_found' | 'empty' | 'error' | 'timeout' | 'skipped';
  latencyMs: number;
  message?: string;
  actuacionesCount?: number;
}

interface DebugResult {
  ok: boolean;
  provider_used: string;
  status: number;
  latencyMs: number;
  summary: DebugSummary;
  raw: unknown;
  error?: string;
  truncated?: boolean;
  // New workflow-aware fields
  workflow_type?: string;
  provider_attempts?: ProviderAttempt[];
  provider_order_reason?: string;
}

// Workflow-specific provider order (mirrors Edge Function logic)
// CGP/LABORAL: Estados are primary notification source; CPNU/SAMAI for enrichment
// TUTELA: TUTELAS API primary, CPNU fallback
// PENAL_906: CPNU primary, Publicaciones are first-class source
// CPACA: SAMAI primary (administrative litigation)
const WORKFLOW_PROVIDER_ORDER: Record<WorkflowType, { primary: string; fallback: string | null; description: string; notificationSource?: string }> = {
  CGP: { primary: 'CPNU', fallback: 'SAMAI', description: 'CPNU primario, SAMAI fallback', notificationSource: 'Estados (términos legales)' },
  LABORAL: { primary: 'CPNU', fallback: 'SAMAI', description: 'CPNU primario, SAMAI fallback', notificationSource: 'Estados (términos legales)' },
  CPACA: { primary: 'SAMAI', fallback: null, description: 'SAMAI primario (litigio administrativo)' },
  TUTELA: { primary: 'TUTELAS', fallback: 'CPNU', description: 'TUTELAS API primario, CPNU fallback' },
  PENAL_906: { primary: 'CPNU', fallback: 'SAMAI', description: 'CPNU primario + Publicaciones', notificationSource: 'Publicaciones Procesales' },
};

// ============== Helper Functions ==============

function normalizeRadicado(input: string): string {
  return input.replace(/\D/g, "");
}

function isValidRadicado(input: string): boolean {
  return normalizeRadicado(input).length === 23;
}

function isValidTutelaCode(input: string): boolean {
  return /^T\d{6,10}$/i.test(input);
}

// ============== Components ==============

function SecretStatusBadge({ name, present }: { name: string; present: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded">
      <span className="font-mono text-sm">{name}</span>
      {present ? (
        <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Present
        </Badge>
      ) : (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Missing
        </Badge>
      )}
    </div>
  );
}

function ReachabilityStatus({ name, data }: { name: string; data?: { ok: boolean; status?: number; latencyMs?: number; error?: string } }) {
  if (!data) return null;
  
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded">
      <div className="flex items-center gap-2">
        {data.ok ? (
          <Wifi className="h-4 w-4 text-emerald-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-destructive" />
        )}
        <span className="font-medium capitalize">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {data.status && (
          <Badge variant="outline" className="text-xs">
            HTTP {data.status}
          </Badge>
        )}
        {data.latencyMs && (
          <Badge variant="secondary" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {data.latencyMs}ms
          </Badge>
        )}
        {data.error && (
          <span className="text-xs text-destructive truncate max-w-32" title={data.error}>
            {data.error}
          </span>
        )}
      </div>
    </div>
  );
}

function JsonViewer({ data, title }: { data: unknown; title?: string }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("JSON copiado al portapapeles");
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="flex items-center gap-2 hover:text-primary transition-colors">
          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-sm font-medium">{title || "Ver JSON Raw"}</span>
        </CollapsibleTrigger>
        <Button variant="ghost" size="sm" onClick={copyJson}>
          <Copy className="h-3 w-3 mr-1" />
          Copiar
        </Button>
      </div>
      <CollapsibleContent>
        <ScrollArea className="h-64 mt-2 rounded border bg-muted/30 p-3">
          <pre className="text-xs font-mono whitespace-pre-wrap">
            {JSON.stringify(data, null, 2)}
          </pre>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============== Main Component ==============

export default function ApiDebugPage() {
  const { isPlatformAdmin, isLoading: platformLoading } = usePlatformAdmin();
  const [provider, setProvider] = useState<ProviderName>("cpnu");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("CGP");
  const [radicado, setRadicado] = useState("");
  const [tutelaCode, setTutelaCode] = useState("");
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);

  // Check if user has admin access
  const { data: hasAdminAccess, isLoading: accessLoading } = useQuery({
    queryKey: ["api-debug-access"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Check platform admin
      const { data: platformAdmin } = await supabase
        .from("platform_admins")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (platformAdmin) return true;

      // Check org admin
      const { data: adminMemberships } = await supabase
        .from("organization_memberships")
        .select("id, role")
        .eq("user_id", user.id)
        .in("role", ["OWNER", "ADMIN"])
        .limit(1);

      return (adminMemberships?.length ?? 0) > 0;
    },
  });

  // Fetch integration health with retry/backoff for 404/network errors
  const {
    data: healthData,
    isLoading: healthLoading,
    refetch: refetchHealth,
    error: healthError,
  } = useQuery({
    queryKey: ["integration-health"],
    queryFn: async () => {
      const maxRetries = 3;
      const retryDelayMs = 2000;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const { data, error } = await supabase.functions.invoke<IntegrationHealthResult>(
            "integration-health",
            { body: {} }
          );
          if (error) {
            // Check if it's a 404 or network error (propagation issue)
            const is404 = error.message?.includes("404") || error.message?.includes("Not Found");
            const isNetworkError = error.message?.includes("Failed to fetch") || error.message?.includes("network");
            
            if ((is404 || isNetworkError) && attempt < maxRetries) {
              console.warn(`[integration-health] Attempt ${attempt}/${maxRetries} failed (${error.message}), retrying in ${retryDelayMs}ms...`);
              await new Promise(r => setTimeout(r, retryDelayMs));
              continue;
            }
            throw error;
          }
          return data;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxRetries) {
            console.warn(`[integration-health] Attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelayMs}ms...`);
            await new Promise(r => setTimeout(r, retryDelayMs));
          }
        }
      }
      
      throw new Error(`integration-health failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`);
    },
    enabled: hasAdminAccess === true,
    staleTime: 60000,
    retry: false, // We handle retries manually above
  });

  // Fetch with reachability check
  const reachabilityMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<IntegrationHealthResult>(
        "integration-health",
        { 
          body: {},
          headers: { 'Content-Type': 'application/json' },
        }
      );
      
      // Manually add query param for reachability
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/integration-health?reachability=true`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json() as IntegrationHealthResult;
    },
    onSuccess: (data) => {
      toast.success("Verificación de conectividad completada");
    },
    onError: (err) => {
      toast.error(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    },
  });

  // Test provider mutation
  const testProviderMutation = useMutation({
    mutationFn: async () => {
      const identifier: { radicado?: string; tutela_code?: string } = {};
      
      if (provider === "tutelas") {
        if (tutelaCode && isValidTutelaCode(tutelaCode)) {
          identifier.tutela_code = tutelaCode;
        } else if (radicado && isValidRadicado(radicado)) {
          identifier.radicado = normalizeRadicado(radicado);
        } else {
          throw new Error("TUTELAS requiere tutela_code (T + dígitos) o radicado válido");
        }
      } else {
        if (!radicado || !isValidRadicado(radicado)) {
          throw new Error(`${provider.toUpperCase()} requiere un radicado de 23 dígitos`);
        }
        identifier.radicado = normalizeRadicado(radicado);
      }

      const { data, error } = await supabase.functions.invoke<DebugResult>(
        "debug-external-provider",
        {
          body: {
            provider,
            identifier,
            mode: "lookup",
            timeoutMs: 15000,
          },
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setDebugResult(data);
      if (data?.ok && data.summary?.found) {
        toast.success(`Provider ${data.provider_used.toUpperCase()} respondió correctamente`);
      } else if (data?.ok) {
        toast.info(`Provider respondió pero no encontró datos`);
      } else {
        toast.warning(`Provider retornó error: ${data?.error || "Unknown"}`);
      }
    },
    onError: (err) => {
      toast.error(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
      setDebugResult(null);
    },
  });

  // Run sync mutation (calls actual sync functions)
  const runSyncMutation = useMutation({
    mutationFn: async () => {
      // For now, just show a message - actual sync requires a work_item_id
      throw new Error(
        "Para ejecutar sync con escritura a DB, use el botón 'Actualizar' desde la vista del proceso. " +
        "Esta página solo permite probar la conectividad con los proveedores."
      );
    },
    onError: (err) => {
      toast.info(err instanceof Error ? err.message : "Info");
    },
  });

  // Access check
  if (platformLoading || accessLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAdminAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Acceso Restringido</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Esta página requiere permisos de administrador de plataforma o administrador de organización.
        </p>
      </div>
    );
  }

  const allSecretsPresent = healthData?.env && Object.values(healthData.env).every(Boolean);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <Bug className="h-6 w-6 text-primary" />
            API Debug Console
          </h1>
          <p className="text-muted-foreground text-sm">
            Pruebas de conectividad con proveedores externos vía Edge Functions
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          <Shield className="h-3 w-3 mr-1" />
          {isPlatformAdmin ? "Platform Admin" : "Org Admin"}
        </Badge>
      </div>

      {/* Integration Health Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Estado de Integración
          </CardTitle>
          <CardDescription>
            Verificación de secretos y conectividad con proveedores externos
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {healthLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando secretos...
            </div>
          ) : healthError ? (
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="h-4 w-4" />
              Error: {healthError instanceof Error ? healthError.message : "Unknown"}
            </div>
          ) : healthData ? (
            <>
              {/* Overall status */}
              <div className={cn(
                "flex items-center gap-3 p-4 rounded-lg",
                allSecretsPresent ? "bg-emerald-500/10" : "bg-destructive/10"
              )}>
                {allSecretsPresent ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                )}
                <div>
                  <p className="font-medium">
                    {allSecretsPresent ? "Todos los secretos configurados" : "Faltan secretos"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Última verificación: {new Date(healthData.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              {/* Secret status grid */}
              <div className="grid gap-2">
                {healthData.env && Object.entries(healthData.env).map(([name, present]) => (
                  <SecretStatusBadge key={name} name={name} present={present} />
                ))}
              </div>

              {/* Reachability section */}
              {reachabilityMutation.data?.reachability && (
                <>
                  <Separator className="my-4" />
                  <h4 className="font-medium flex items-center gap-2">
                    <Wifi className="h-4 w-4" />
                    Conectividad con Proveedores
                  </h4>
                  <div className="grid gap-2">
                    {Object.entries(reachabilityMutation.data.reachability).map(([name, data]) => (
                      <ReachabilityStatus key={name} name={name} data={data} />
                    ))}
                  </div>
                </>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchHealth()}
                  disabled={healthLoading}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-1", healthLoading && "animate-spin")} />
                  Actualizar Estado
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reachabilityMutation.mutate()}
                  disabled={reachabilityMutation.isPending}
                >
                  {reachabilityMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-1" />
                  )}
                  Probar Conectividad
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Provider Tester Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            Probar Proveedor
          </CardTitle>
          <CardDescription>
            Ejecuta una consulta de prueba a un proveedor específico vía Edge Function
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Workflow + Provider selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="workflow">Flujo de Trabajo</Label>
              <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
                <SelectTrigger id="workflow">
                  <SelectValue placeholder="Seleccionar flujo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CGP">CGP (Civil General)</SelectItem>
                  <SelectItem value="LABORAL">LABORAL</SelectItem>
                  <SelectItem value="CPACA">CPACA (Administrativo)</SelectItem>
                  <SelectItem value="TUTELA">TUTELA</SelectItem>
                  <SelectItem value="PENAL_906">PENAL 906</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {WORKFLOW_PROVIDER_ORDER[workflowType].description}
                {WORKFLOW_PROVIDER_ORDER[workflowType].notificationSource && (
                  <span className="block text-xs text-primary mt-1">
                    📋 Fuente de notificación: {WORKFLOW_PROVIDER_ORDER[workflowType].notificationSource}
                  </span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">Proveedor a Probar</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as ProviderName)}>
                <SelectTrigger id="provider">
                  <SelectValue placeholder="Seleccionar proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpnu">
                    CPNU {workflowType !== 'CPACA' && workflowType !== 'TUTELA' ? '(Primario)' : ''}
                  </SelectItem>
                  <SelectItem value="samai">
                    SAMAI {workflowType === 'CPACA' ? '(Primario para CPACA)' : ''}
                  </SelectItem>
                  <SelectItem value="tutelas">TUTELAS</SelectItem>
                  <SelectItem value="publicaciones">PUBLICACIONES</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Identifier inputs */}
            {provider === "tutelas" ? (
              <div className="space-y-2">
                <Label htmlFor="tutela-code">Código Tutela (T + dígitos)</Label>
                <Input
                  id="tutela-code"
                  placeholder="T11728622"
                  value={tutelaCode}
                  onChange={(e) => setTutelaCode(e.target.value.toUpperCase())}
                />
                <p className="text-xs text-muted-foreground">
                  O ingrese radicado en el campo inferior como fallback
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="radicado">
                Radicado (23 dígitos)
                {provider === "tutelas" && " — opcional"}
              </Label>
              <Input
                id="radicado"
                placeholder="05001400301520240193000"
                value={radicado}
                onChange={(e) => setRadicado(e.target.value.replace(/\D/g, ""))}
                maxLength={23}
                inputMode="numeric"
              />
              {radicado && !isValidRadicado(radicado) && (
                <p className="text-xs text-destructive">
                  {radicado.length}/23 dígitos
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              onClick={() => testProviderMutation.mutate()}
              disabled={testProviderMutation.isPending || !allSecretsPresent}
            >
              {testProviderMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Probar Proveedor
            </Button>
            <Button
              variant="outline"
              onClick={() => runSyncMutation.mutate()}
              disabled
              title="Use la vista del proceso para ejecutar sync con escritura a DB"
            >
              <Database className="h-4 w-4 mr-2" />
              Run Sync (DB write)
            </Button>
          </div>

          {!allSecretsPresent && (
            <p className="text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              Configure todos los secretos antes de probar proveedores.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results Card */}
      {debugResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {debugResult.ok && debugResult.summary.found ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              ) : debugResult.ok ? (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              Resultado: {debugResult.provider_used.toUpperCase()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status badges */}
            <div className="flex flex-wrap gap-2">
              <Badge variant={debugResult.ok ? "secondary" : "destructive"}>
                HTTP {debugResult.status}
              </Badge>
              <Badge variant="outline">
                <Clock className="h-3 w-3 mr-1" />
                {debugResult.latencyMs}ms
              </Badge>
              {debugResult.workflow_type && (
                <Badge variant="outline">
                  Workflow: {debugResult.workflow_type}
                </Badge>
              )}
              {debugResult.truncated && (
                <Badge variant="outline" className="text-amber-600">
                  Respuesta truncada
                </Badge>
              )}
            </div>

            {/* Provider Attempts (workflow-aware) */}
            {debugResult.provider_attempts && debugResult.provider_attempts.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Intentos de Proveedores
                  {debugResult.provider_order_reason && (
                    <span className="text-xs text-muted-foreground">
                      ({debugResult.provider_order_reason})
                    </span>
                  )}
                </h4>
                <div className="space-y-1">
                  {debugResult.provider_attempts.map((attempt, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "flex items-center justify-between p-2 rounded text-sm",
                        attempt.status === 'success' ? "bg-emerald-500/10" :
                        attempt.status === 'skipped' ? "bg-muted/50" :
                        "bg-destructive/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium uppercase">{attempt.provider}</span>
                        <Badge 
                          variant={attempt.status === 'success' ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {attempt.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {attempt.actuacionesCount !== undefined && (
                          <span className="text-xs">{attempt.actuacionesCount} acts</span>
                        )}
                        <span className="text-xs">{attempt.latencyMs}ms</span>
                        {attempt.message && (
                          <span className="text-xs truncate max-w-32" title={attempt.message}>
                            {attempt.message}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Summary */}
            {debugResult.summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Encontrado</p>
                  <p className="font-medium">{debugResult.summary.found ? "Sí" : "No"}</p>
                </div>
                {debugResult.summary.actuacionesCount !== undefined && (
                  <div>
                    <p className="text-xs text-muted-foreground">Actuaciones</p>
                    <p className="font-medium">{debugResult.summary.actuacionesCount}</p>
                  </div>
                )}
                {debugResult.summary.publicacionesCount !== undefined && (
                  <div>
                    <p className="text-xs text-muted-foreground">Publicaciones</p>
                    <p className="font-medium">{debugResult.summary.publicacionesCount}</p>
                  </div>
                )}
                {debugResult.summary.despacho && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Despacho</p>
                    <p className="font-medium text-sm truncate">{debugResult.summary.despacho}</p>
                  </div>
                )}
              </div>
            )}

            {/* Error display */}
            {debugResult.error && (
              <div className="p-4 bg-destructive/10 rounded-lg">
                <p className="text-sm text-destructive">{debugResult.error}</p>
              </div>
            )}

            {/* Raw JSON */}
            {debugResult.raw && (
              <JsonViewer data={debugResult.raw} title="Ver Respuesta Raw" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Documentation link */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">Documentación</h4>
              <p className="text-sm text-muted-foreground">
                Consulta el runbook de integración para más detalles
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/docs/integration-runbook.md" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />
                Ver Runbook
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
