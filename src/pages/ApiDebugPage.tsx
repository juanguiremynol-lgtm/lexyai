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
  Mail,
  Send,
  Database,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============== Types ==============

type ProviderName = "cpnu" | "samai" | "tutelas" | "publicaciones";
type WorkflowType = "CGP" | "LABORAL" | "CPACA" | "TUTELA" | "PENAL_906";

interface EmailGatewayHealth {
  configured: boolean;
  base_url_set: boolean;
  api_key_set: boolean;
  from_address_set: boolean;
}

interface AuthDiagnostics {
  auth_header_used: string;
  api_key_source: string;
  api_key_present: boolean;
  api_key_fingerprint: string | null;
}

// NEW: Provider connectivity check (GET /health)
interface ProviderConnectivityCheck {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

// NEW: Provider auth check (GET /snapshot with test radicado)
interface ProviderAuthCheck {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
  error_code?: string;
  api_key_source: string;
  api_key_present: boolean;
  api_key_fingerprint: string | null;
  test_identifier_used?: string;
  auth_endpoint_used?: string; // NEW: The actual endpoint used for auth test
  hint?: string;
  response_kind?: 'JSON' | 'HTML_CANNOT_GET' | 'HTML_OTHER' | 'EMPTY' | 'ERROR';
  response_headers_snippet?: Record<string, string>;
}

// NEW: Combined provider health check
interface ProviderHealthCheck {
  connectivity: ProviderConnectivityCheck;
  auth?: ProviderAuthCheck;
}

interface IntegrationHealthResult {
  ok: boolean;
  env: Record<string, boolean>;
  optional_keys?: Record<string, boolean>;
  email_gateway?: EmailGatewayHealth;
  reachability?: Record<string, { ok: boolean; status?: number; latencyMs?: number; error?: string }>;
  auth_checks?: Record<string, { ok: boolean; status?: number; latencyMs?: number; error?: string; api_key_source: string; api_key_present: boolean; api_key_fingerprint: string | null }>;
  // NEW: Combined connectivity + auth checks per provider
  provider_health?: Record<string, ProviderHealthCheck>;
  // NEW: Test identifier configuration
  test_identifiers?: {
    cpnu_test_radicado_set: boolean;
    samai_test_radicado_set: boolean;
  };
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

// Route attempt from debug-external-provider (for route probing diagnostics)
interface RouteAttempt {
  path: string;
  http_status: number;
  latency_ms: number;
  response_kind: 'JSON' | 'HTML_CANNOT_GET' | 'HTML_OTHER' | 'EMPTY' | 'ERROR';
  error?: string;
}

interface DebugResult {
  ok: boolean;
  provider_used: string;
  status: number;
  latencyMs: number;
  auth?: AuthDiagnostics;
  summary: DebugSummary;
  raw: unknown;
  error?: string;
  error_code?: string;
  message?: string;
  truncated?: boolean;
  // Enhanced diagnostics
  request_url?: string; // Legacy: path only
  request_url_masked?: string; // New: <PROVIDER>/path
  request_path?: string; // Path only, no host/secrets
  request_method?: string;
  // Path prefix diagnostics (new)
  path_prefix_used?: string; // The prefix applied (e.g., "" or "/cpnu")
  path_prefix_note?: string; // Hint about prefix configuration
  // Workflow-aware fields
  workflow_type?: string;
  provider_attempts?: ProviderAttempt[];
  provider_order_reason?: string;
  // Route probing results
  attempts?: RouteAttempt[];
  route_probing_used?: boolean;
  // Debug body snippet for errors
  _debug_body_snippet?: string;
}

// Workflow-specific provider order (mirrors Edge Function logic)
// CGP/LABORAL: Estados are primary notification source; CPNU/SAMAI for enrichment
// TUTELA: TUTELAS API primary, CPNU fallback
// PENAL_906: PUBLICACIONES is PRIMARY sync source (called FIRST)
// CPACA: SAMAI primary (administrative litigation)
// Provider order per workflow (mirrors sync-by-work-item Edge Function logic)
// IMPORTANT: PENAL_906 uses Publicaciones as PRIMARY sync source (called FIRST)
const WORKFLOW_PROVIDER_ORDER: Record<WorkflowType, { 
  primary: string; 
  fallback: string | null; 
  fallbackEnabled: boolean;
  description: string; 
  notificationSource?: string;
}> = {
  CGP: { 
    primary: 'CPNU', 
    fallback: 'SAMAI', 
    fallbackEnabled: true,
    description: 'CPNU primario, SAMAI fallback', 
    notificationSource: 'Estados (términos legales)' 
  },
  LABORAL: { 
    primary: 'CPNU', 
    fallback: 'SAMAI', 
    fallbackEnabled: true,
    description: 'CPNU primario, SAMAI fallback', 
    notificationSource: 'Estados (términos legales)' 
  },
  CPACA: { 
    primary: 'SAMAI', 
    fallback: 'CPNU', 
    fallbackEnabled: false,
    description: 'SAMAI primario (litigio administrativo), CPNU fallback deshabilitado' 
  },
  TUTELA: { 
    primary: 'TUTELAS', 
    fallback: 'CPNU', 
    fallbackEnabled: true,
    description: 'TUTELAS API primario, CPNU fallback si TUTELAS vacío' 
  },
  PENAL_906: { 
    primary: 'PUBLICACIONES', 
    fallback: 'CPNU', 
    fallbackEnabled: false,
    description: '⚠️ Publicaciones es PRIMARY (se llama PRIMERO). CPNU/SAMAI deshabilitados.', 
    notificationSource: 'Publicaciones Procesales' 
  },
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

// ============== Publicaciones Sync Result Card (v3 Synchronous API) ==============

interface PublicacionesSyncResultProps {
  result: { success: boolean; data?: any; error?: string };
  onRetry: () => void;
  isRetrying: boolean;
}

function PublicacionesSyncResultCard({ result, onRetry, isRetrying }: PublicacionesSyncResultProps) {
  const data = result.data;
  const status = data?.status as string | undefined;
  const insertedCount = data?.inserted_count || 0;
  const skippedCount = data?.skipped_count || 0;
  const latencyMs = data?.provider_latency_ms || 0;

  const getStatusIcon = () => {
    if (isRetrying) return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    if (status === 'SUCCESS') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (status === 'EMPTY') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    if (result.success) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const getStatusBadge = () => {
    if (isRetrying) return <Badge className="bg-blue-500/20 text-blue-700">⏳ Syncing...</Badge>;
    if (status === 'SUCCESS') return <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">✅ Success</Badge>;
    if (status === 'EMPTY') return <Badge variant="secondary" className="bg-amber-500/20 text-amber-700">📭 No publications</Badge>;
    if (result.success) return <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">✅ OK</Badge>;
    return <Badge variant="destructive">❌ Error</Badge>;
  };

  const bgColor = result.success 
    ? status === 'EMPTY' 
      ? "bg-amber-500/10 border-amber-500/30" 
      : "bg-emerald-500/10 border-emerald-500/30" 
    : "bg-destructive/10 border-destructive/30";

  return (
    <div className={cn("p-4 rounded-lg border", bgColor)}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium flex items-center gap-2">
          {getStatusIcon()}
          Publicaciones (v3 Sync API)
        </h4>
        {getStatusBadge()}
      </div>

      {/* Success with data */}
      {result.success && status === 'SUCCESS' && (
        <div className="space-y-2">
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-600">✅ Inserted: {insertedCount}</span>
            <span className="text-muted-foreground">Skipped: {skippedCount}</span>
            {latencyMs > 0 && (
              <span className="text-muted-foreground">
                <Clock className="h-3 w-3 inline mr-1" />
                {latencyMs}ms
              </span>
            )}
          </div>
          {data?.inserted && data.inserted.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Inserted publications:</p>
              <ul className="text-xs space-y-1">
                {data.inserted.slice(0, 5).map((pub: any, idx: number) => (
                  <li key={idx} className="flex items-center gap-2">
                    <span className="truncate max-w-[300px]">{pub.title}</span>
                    {pub.pdf_url && (
                      <a 
                        href={pub.pdf_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Empty result */}
      {result.success && status === 'EMPTY' && (
        <p className="text-sm text-amber-700">
          No publications found for this radicado. The provider responded successfully but returned 0 results.
        </p>
      )}

      {/* Error */}
      {!result.success && (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{result.error || data?.errors?.join(', ') || 'Sync failed'}</p>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onRetry}
            disabled={isRetrying}
          >
            {isRetrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Retry
          </Button>
        </div>
      )}
      
      {/* Raw data for debugging */}
      {data && (
        <details className="mt-3">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            View raw response
          </summary>
          <pre className="text-[10px] text-muted-foreground bg-muted/50 rounded p-2 mt-1 font-mono overflow-auto max-h-48">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
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

// Helper to get default auth endpoint label per provider
function getDefaultAuthEndpoint(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'cpnu': return '/snapshot';
    case 'samai': return '/buscar'; // SAMAI only has /buscar (returns 200 + jobId)
    case 'tutelas': return '/expediente/{id}';
    case 'publicaciones': return '/publicaciones';
    default: return '/auth';
  }
}

// NEW: Provider Health Status (split connectivity + auth)
function ProviderHealthStatus({ 
  name, 
  health,
  testRadicadoConfigured 
}: { 
  name: string; 
  health?: ProviderHealthCheck;
  testRadicadoConfigured: boolean;
}) {
  if (!health) return null;
  
  const { connectivity, auth } = health;
  
  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium uppercase text-sm">{name}</span>
        <div className="flex gap-2">
          {/* Connectivity badge */}
          {connectivity.ok ? (
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700 text-xs">
              <Wifi className="h-3 w-3 mr-1" />
              /health OK
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-xs">
              <WifiOff className="h-3 w-3 mr-1" />
              /health {connectivity.status || 'Error'}
            </Badge>
          )}
          
          {/* Auth badge - CRITICAL: ROUTE_NOT_FOUND is NOT "Auth OK" */}
          {auth?.ok && auth?.error_code !== 'UPSTREAM_ROUTE_MISSING' ? (
            <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700 text-xs">
              <Shield className="h-3 w-3 mr-1" />
              Auth OK{auth?.error_code === 'RECORD_NOT_FOUND' && ' (record 404)'}
            </Badge>
          ) : auth?.error_code === 'SKIPPED' ? (
            <Badge variant="outline" className="text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Auth skipped
            </Badge>
          ) : auth?.error_code === 'UPSTREAM_ROUTE_MISSING' ? (
            <Badge variant="destructive" className="text-xs">
              <WifiOff className="h-3 w-3 mr-1" />
              Route Missing
            </Badge>
          ) : auth ? (
            <Badge variant="destructive" className="text-xs">
              <Shield className="h-3 w-3 mr-1" />
              Auth {auth.status || auth.error_code}
            </Badge>
          ) : null}
        </div>
      </div>
      
      {/* Details row */}
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        <div>
          <span className="block font-medium text-foreground">Conectividad (/health)</span>
          {connectivity.ok ? (
            <span className="text-emerald-600">HTTP {connectivity.status} • {connectivity.latencyMs}ms</span>
          ) : (
            <span className="text-destructive">{connectivity.error || `HTTP ${connectivity.status}`}</span>
          )}
        </div>
        
        <div>
          <span className="block font-medium text-foreground">
            Auth ({auth?.auth_endpoint_used || getDefaultAuthEndpoint(name)})
          </span>
          {auth?.error_code === 'SKIPPED' ? (
            <span className="text-muted-foreground">Sin test radicado configurado</span>
          ) : auth?.error_code === 'UPSTREAM_ROUTE_MISSING' ? (
            <span className="text-destructive">
              HTTP {auth.status} • Route Missing (endpoint no existe)
            </span>
          ) : auth?.ok ? (
            <span className="text-emerald-600">
              HTTP {auth.status} • {auth.latencyMs}ms
              {auth.error_code === 'RECORD_NOT_FOUND' && ' (record not found, auth OK)'}
            </span>
          ) : auth ? (
            <span className="text-destructive">
              {auth.error_code}: {auth.error?.slice(0, 50)}
            </span>
          ) : (
            <span className="text-muted-foreground">No verificado</span>
          )}
        </div>
      </div>
      
      {/* Auth diagnostics */}
      {auth && (
        <div className="text-xs space-y-1 bg-muted/30 rounded p-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">API Key Source:</span>
            <span className="font-mono">{auth.api_key_source}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Key Present:</span>
            <span>{auth.api_key_present ? '✓ Yes' : '✗ No'}</span>
          </div>
          {auth.api_key_fingerprint && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fingerprint:</span>
              <span className="font-mono">{auth.api_key_fingerprint}</span>
            </div>
          )}
          {auth.test_identifier_used && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Test ID:</span>
              <span className="font-mono">{auth.test_identifier_used}</span>
            </div>
          )}
        </div>
      )}
      
      {/* Hint */}
      {auth?.hint && !auth.ok && auth.error_code !== 'SKIPPED' && (
        <div className="text-xs p-2 rounded bg-amber-500/10 text-amber-700 border border-amber-200">
          <AlertTriangle className="h-3 w-3 inline mr-1" />
          {auth.hint}
        </div>
      )}
      
      {/* Skipped hint with configuration guidance */}
      {auth?.error_code === 'SKIPPED' && !testRadicadoConfigured && (
        <div className="text-xs p-2 rounded bg-muted border">
          💡 Para habilitar verificación de auth, configure <code className="bg-muted-foreground/20 px-1 rounded">{name.toUpperCase()}_TEST_RADICADO</code> con un radicado de prueba.
        </div>
      )}
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

// ============== Sync History Card ==============

function SyncHistoryCard() {
  const [isLoading, setIsLoading] = useState(false);
  const [loginSyncRuns, setLoginSyncRuns] = useState<any[]>([]);
  const [dailySyncLedger, setDailySyncLedger] = useState<any[]>([]);

  const fetchHistory = async () => {
    setIsLoading(true);
    try {
      // Fetch recent login sync runs
      const { data: loginRuns, error: loginError } = await supabase
        .from('auto_sync_login_runs')
        .select('id, user_id, organization_id, run_count, run_date, last_run_at, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10);

      if (!loginError && loginRuns) {
        setLoginSyncRuns(loginRuns);
      }

      // Fetch recent daily sync ledger entries
      const { data: dailyRuns, error: dailyError } = await supabase
        .from('auto_sync_daily_ledger')
        .select('id, organization_id, run_date, scheduled_for, status, items_targeted, items_succeeded, items_failed, started_at, completed_at, last_error')
        .order('run_date', { ascending: false })
        .limit(10);

      if (!dailyError && dailyRuns) {
        setDailySyncLedger(dailyRuns);
      }
    } catch (err) {
      console.error('Error fetching sync history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Historial de Sincronización Automática
        </CardTitle>
        <CardDescription>
          Registros de useLoginSync (on-login) y Daily Sync (scheduled cron)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          size="sm"
          onClick={fetchHistory}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Cargar Historial
        </Button>

        {loginSyncRuns.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Login Sync Runs (auto_sync_login_runs)
            </h4>
            <p className="text-xs text-muted-foreground">
              Límite: 3 syncs por usuario por día
            </p>
            <ScrollArea className="h-40">
              <div className="space-y-1">
                {loginSyncRuns.map((run) => (
                  <div key={run.id} className="text-xs p-2 bg-muted/50 rounded flex justify-between items-center">
                    <div>
                      <span className="font-mono">{run.run_date}</span>
                      <span className="text-muted-foreground ml-2">
                        user: {run.user_id?.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {run.run_count}/3 runs
                      </Badge>
                      {run.last_run_at && (
                        <span className="text-muted-foreground">
                          {new Date(run.last_run_at).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {dailySyncLedger.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              Daily Sync Ledger (auto_sync_daily_ledger)
            </h4>
            <p className="text-xs text-muted-foreground">
              Scheduled 7:00 AM COT - exactamente una vez por día por org
            </p>
            <ScrollArea className="h-40">
              <div className="space-y-1">
                {dailySyncLedger.map((entry) => (
                  <div key={entry.id} className="text-xs p-2 bg-muted/50 rounded flex justify-between items-center">
                    <div>
                      <span className="font-mono">{entry.run_date}</span>
                      <span className="text-muted-foreground ml-2">
                        org: {entry.organization_id?.slice(0, 8)}...
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant={
                          entry.status === 'SUCCESS' ? 'secondary' : 
                          entry.status === 'RUNNING' ? 'default' :
                          entry.status === 'FAILED' ? 'destructive' : 
                          'outline'
                        }
                        className="text-[10px]"
                      >
                        {entry.status}
                      </Badge>
                      {entry.items_targeted && (
                        <span className="text-muted-foreground">
                          {entry.items_succeeded}/{entry.items_targeted} items
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {loginSyncRuns.length === 0 && dailySyncLedger.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">
            Haga clic en "Cargar Historial" para ver los registros de sincronización automática.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ============== Main Component ==============

// Map workflow → primary provider for auto-selection
const WORKFLOW_TO_PRIMARY_PROVIDER: Record<WorkflowType, ProviderName> = {
  CGP: 'cpnu',
  LABORAL: 'cpnu',
  CPACA: 'samai',
  TUTELA: 'tutelas',
  PENAL_906: 'publicaciones',
};

export default function ApiDebugPage() {
  const { isPlatformAdmin, isLoading: platformLoading } = usePlatformAdmin();
  const [provider, setProvider] = useState<ProviderName>("cpnu");
  const [workflowType, setWorkflowType] = useState<WorkflowType>("CGP");
  const [radicado, setRadicado] = useState("");
  const [tutelaCode, setTutelaCode] = useState("");
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [workItemIdForSuggestion, setWorkItemIdForSuggestion] = useState("");

  // Auto-select provider when workflow changes
  useEffect(() => {
    const primaryProvider = WORKFLOW_TO_PRIMARY_PROVIDER[workflowType];
    if (primaryProvider && primaryProvider !== provider) {
      setProvider(primaryProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowType]);

  // Fetch pending stage suggestions for a work item
  const { 
    data: pendingSuggestions, 
    isLoading: suggestionsLoading,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ["debug-stage-suggestions", workItemIdForSuggestion],
    queryFn: async () => {
      if (!workItemIdForSuggestion || workItemIdForSuggestion.length < 10) return null;
      
      const { data, error } = await supabase
        .from("work_item_stage_suggestions")
        .select("*")
        .eq("work_item_id", workItemIdForSuggestion)
        .order("created_at", { ascending: false })
        .limit(5);
      
      if (error) throw error;
      return data;
    },
    enabled: workItemIdForSuggestion.length > 10,
  });

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

  // State for sync results
  const [syncResults, setSyncResults] = useState<{
    actuaciones?: { success: boolean; data?: any; error?: string };
    publicaciones?: { success: boolean; data?: any; error?: string };
  } | null>(null);
  const [dbResults, setDbResults] = useState<{
    actuaciones: any[];
    publicaciones: any[];
  } | null>(null);

  // Run sync mutation (calls actual sync functions)
  const runSyncMutation = useMutation({
    mutationFn: async () => {
      const normalizedRadicado = normalizeRadicado(radicado);
      
      if (!isValidRadicado(radicado)) {
        throw new Error("Ingrese un radicado válido de 23 dígitos para ejecutar sync");
      }

      // Step 1: Find work_item_id from radicado
      const { data: workItem, error: lookupError } = await supabase
        .from('work_items')
        .select('id, radicado, workflow_type, organization_id')
        .eq('radicado', normalizedRadicado)
        .is('deleted_at', null)
        .maybeSingle();

      if (lookupError) {
        throw new Error(`Error buscando work_item: ${lookupError.message}`);
      }

      if (!workItem) {
        throw new Error(`No existe work_item con radicado ${normalizedRadicado}. Cree uno primero.`);
      }

      console.log(`[debug] Running full sync for work_item ${workItem.id} (${workItem.workflow_type})`);

      // Step 2: Call BOTH edge functions in parallel
      const [actsResult, pubsResult] = await Promise.allSettled([
        supabase.functions.invoke('sync-by-work-item', {
          body: { work_item_id: workItem.id }
        }),
        supabase.functions.invoke('sync-publicaciones-by-work-item', {
          body: { work_item_id: workItem.id }
        }),
      ]);

      // Step 3: Process results
      const actsData = actsResult.status === 'fulfilled' ? actsResult.value.data : null;
      const actsError = actsResult.status === 'rejected' 
        ? actsResult.reason?.message 
        : actsResult.value?.error?.message || actsResult.value?.error;
      const pubsData = pubsResult.status === 'fulfilled' ? pubsResult.value.data : null;
      const pubsError = pubsResult.status === 'rejected' 
        ? pubsResult.reason?.message 
        : pubsResult.value?.error?.message || pubsResult.value?.error;

      setSyncResults({
        actuaciones: {
          success: !actsError && actsData?.ok !== false,
          data: actsData,
          error: actsError,
        },
        publicaciones: {
          success: !pubsError && pubsData?.ok !== false,
          data: pubsData,
          error: pubsError,
        },
      });

      // Step 4: Query database to show what was actually inserted
      const { data: acts } = await supabase
        .from('work_item_acts')
        .select('id, act_date, description, source, created_at')
        .eq('work_item_id', workItem.id)
        .order('act_date', { ascending: false })
        .limit(10);

      const { data: pubs } = await supabase
        .from('work_item_publicaciones')
        .select('id, title, pdf_url, fecha_fijacion, source, created_at')
        .eq('work_item_id', workItem.id)
        .order('created_at', { ascending: false })
        .limit(10);

      setDbResults({
        actuaciones: acts || [],
        publicaciones: pubs || [],
      });

      return {
        workItemId: workItem.id,
        workflowType: workItem.workflow_type,
        actsCount: acts?.length || 0,
        pubsCount: pubs?.length || 0,
        actsError,
        pubsError,
      };
    },
    onSuccess: (data) => {
      const hasErrors = data.actsError || data.pubsError;
      if (hasErrors) {
        toast.warning(`Sync completado con errores: ${data.actsCount} actuaciones, ${data.pubsCount} publicaciones`);
      } else {
        toast.success(`Sync completado: ${data.actsCount} actuaciones, ${data.pubsCount} publicaciones en DB`);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Error desconocido");
      setSyncResults(null);
      setDbResults(null);
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

              {/* NEW: Provider Health Section (Connectivity + Auth) */}
              {healthData.provider_health && (
                <>
                  <Separator className="my-4" />
                  <h4 className="font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Estado de Proveedores (Conectividad + Auth)
                  </h4>
                  <p className="text-xs text-muted-foreground mb-2">
                    /health = conectividad básica (puede ser pública) • /snapshot = verifica auth con API key
                  </p>
                  <div className="grid gap-3">
                    {Object.entries(healthData.provider_health).map(([name, health]) => (
                      <ProviderHealthStatus 
                        key={name} 
                        name={name} 
                        health={health} 
                        testRadicadoConfigured={
                          name === 'cpnu' 
                            ? healthData.test_identifiers?.cpnu_test_radicado_set || false
                            : name === 'samai'
                              ? healthData.test_identifiers?.samai_test_radicado_set || false
                              : name === 'publicaciones'
                                ? (healthData.test_identifiers as any)?.publicaciones_test_radicado_set || false
                                : false
                        }
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Legacy Reachability section */}
              {reachabilityMutation.data?.reachability && (
                <>
                  <Separator className="my-4" />
                  <h4 className="font-medium flex items-center gap-2">
                    <Wifi className="h-4 w-4" />
                    Conectividad con Proveedores (Legacy)
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

      {/* Email Gateway Health Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Gateway (Cloud Run)
          </CardTitle>
          <CardDescription>
            Estado de configuración del gateway de correo (Option B architecture)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {healthLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando configuración...
            </div>
          ) : healthData?.email_gateway ? (
            <>
              <div className={cn(
                "flex items-center gap-3 p-4 rounded-lg",
                healthData.email_gateway.configured ? "bg-emerald-500/10" : "bg-amber-500/10"
              )}>
                {healthData.email_gateway.configured ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-amber-600" />
                )}
                <div>
                  <p className="font-medium">
                    {healthData.email_gateway.configured 
                      ? "Gateway configurado y listo" 
                      : "Gateway no configurado (emails no se enviarán)"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Los emails se encolan en email_outbox y se procesan vía process-email-outbox
                  </p>
                </div>
              </div>

              <div className="grid gap-2">
                <SecretStatusBadge name="EMAIL_GATEWAY_BASE_URL" present={healthData.email_gateway.base_url_set} />
                <SecretStatusBadge name="EMAIL_GATEWAY_API_KEY" present={healthData.email_gateway.api_key_set} />
                <SecretStatusBadge name="EMAIL_FROM_ADDRESS" present={healthData.email_gateway.from_address_set} />
              </div>

              <p className="text-xs text-muted-foreground">
                <Send className="h-3 w-3 inline mr-1" />
                Documentación: <code className="bg-muted px-1 rounded">docs/runbook-email-gateway.md</code>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Ejecute la verificación de integración para ver el estado del gateway.
            </p>
          )}
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
              <div className="text-xs text-muted-foreground space-y-1">
                <p>{WORKFLOW_PROVIDER_ORDER[workflowType].description}</p>
                <p className="font-mono text-[10px]">
                  Primary: {WORKFLOW_PROVIDER_ORDER[workflowType].primary} | 
                  Fallback: {WORKFLOW_PROVIDER_ORDER[workflowType].fallback || 'ninguno'} 
                  ({WORKFLOW_PROVIDER_ORDER[workflowType].fallbackEnabled ? 'habilitado' : 'deshabilitado'})
                </p>
                {WORKFLOW_PROVIDER_ORDER[workflowType].notificationSource && (
                  <span className="block text-xs text-primary">
                    📋 Fuente de notificación: {WORKFLOW_PROVIDER_ORDER[workflowType].notificationSource}
                  </span>
                )}
              </div>
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
              disabled={runSyncMutation.isPending || !isValidRadicado(radicado)}
              title={!isValidRadicado(radicado) ? "Ingrese radicado de 23 dígitos" : "Ejecutar sync completo con escritura a DB"}
            >
              {runSyncMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              {runSyncMutation.isPending ? "Sincronizando... (hasta 2 min)" : "Run Sync (DB write)"}
            </Button>
          </div>

          {!allSecretsPresent && (
            <p className="text-sm text-amber-600">
              <AlertTriangle className="h-4 w-4 inline mr-1" />
              Configure todos los secretos antes de probar proveedores.
            </p>
          )}
          
          {runSyncMutation.isPending && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-700 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sincronizando... El proceso de polling puede tomar hasta 2 minutos mientras espera respuesta del servidor externo.
              </p>
            </div>
          )}

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

            {/* Summary - ENHANCED to distinguish cache miss vs route missing vs not found */}
            {debugResult.summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Estado</p>
                  <p className="font-medium">
                    {debugResult.summary.found 
                      ? "✅ Encontrado" 
                      : debugResult.error_code === 'RECORD_NOT_FOUND' 
                        ? "🔄 Cache miss (auth OK)" 
                        : debugResult.error_code === 'UPSTREAM_ROUTE_MISSING' 
                          ? "❌ Route Missing"
                          : "❌ No encontrado"}
                  </p>
                  {/* CPNU-specific: explain cache miss is not an error */}
                  {debugResult.error_code === 'RECORD_NOT_FOUND' && (
                    <p className="text-[10px] text-emerald-600 mt-1">
                      ✓ Auth OK — snapshot no cacheado (trigger /buscar para scraping)
                    </p>
                  )}
                  {debugResult.error_code === 'UPSTREAM_ROUTE_MISSING' && (
                    <p className="text-[10px] text-destructive mt-1">
                      Endpoint no existe en host configurado
                    </p>
                  )}
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

            {/* Request details for debugging */}
            {(debugResult.request_url_masked || debugResult.request_url || debugResult.request_path) && (
              <div className="p-3 bg-muted/50 rounded-lg border space-y-2">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Request Path (sin host/secrets)</p>
                  <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                    {debugResult.request_method || 'GET'} {debugResult.request_url_masked || debugResult.request_url || debugResult.request_path}
                  </code>
                </div>
                
                {/* Path Prefix Diagnostics */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Path prefix:</span>
                  <code className="font-mono bg-muted px-1 rounded">
                    {debugResult.path_prefix_used === '' || debugResult.path_prefix_used === undefined 
                      ? '(vacío)' 
                      : debugResult.path_prefix_used}
                  </code>
                  {debugResult.path_prefix_note && (
                    <span className="text-amber-600">{debugResult.path_prefix_note}</span>
                  )}
                </div>
              </div>
            )}

            {/* Route Probing Attempts (new diagnostics) */}
            {debugResult.attempts && debugResult.attempts.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-sm">Intentos de Ruta</h4>
                  {debugResult.route_probing_used && (
                    <Badge variant="outline" className="text-xs text-amber-600">
                      Route probing activado
                    </Badge>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  {debugResult.attempts.map((attempt, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "flex items-center justify-between p-2 rounded font-mono",
                        attempt.response_kind === 'JSON' && attempt.http_status < 400 ? "bg-emerald-500/10" :
                        attempt.response_kind === 'HTML_CANNOT_GET' ? "bg-amber-500/10" :
                        "bg-destructive/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{attempt.path}</span>
                        <Badge 
                          variant={attempt.http_status < 400 ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {attempt.http_status || 'ERR'}
                        </Badge>
                        <Badge 
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            attempt.response_kind === 'HTML_CANNOT_GET' && "text-amber-600 border-amber-500",
                            attempt.response_kind === 'JSON' && "text-emerald-600 border-emerald-500"
                          )}
                        >
                          {attempt.response_kind}
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">{attempt.latency_ms}ms</span>
                    </div>
                  ))}
                </div>
                
                {/* Prefix mismatch hint */}
                {debugResult.error_code === 'UPSTREAM_ROUTE_MISSING' && (
                  <div className="text-xs text-amber-600 bg-amber-500/10 p-2 rounded space-y-1">
                    <p className="font-medium">⚠️ Todas las rutas candidatas fallaron con "Cannot GET".</p>
                    <p>
                      {debugResult.path_prefix_used 
                        ? `El prefijo "${debugResult.path_prefix_used}" puede ser incorrecto si el servicio expone rutas en raíz. Configura ${debugResult.provider_used?.toUpperCase()}_PATH_PREFIX vacío.`
                        : `El servicio puede requerir un prefijo (ej: ${debugResult.provider_used?.toUpperCase()}_PATH_PREFIX=/api) o CPNU_BASE_URL apunta al servicio incorrecto.`
                      }
                    </p>
                    <p className="text-muted-foreground">
                      <strong>Hoy:</strong> Cloud Run expuesto en raíz → prefijo vacío. <strong>Futuro:</strong> Gateway unificado → prefijo /cpnu, /samai, etc.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Error display - enhanced with error_code */}
            {(debugResult.error || debugResult.error_code || debugResult.message) && (
              <div className="p-4 bg-destructive/10 rounded-lg space-y-2">
                {debugResult.error_code && (
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">{debugResult.error_code}</Badge>
                    <span className="text-xs text-muted-foreground">HTTP {debugResult.status}</span>
                  </div>
                )}
                <p className="text-sm text-destructive">
                  {debugResult.message || debugResult.error}
                </p>
              </div>
            )}

            {/* Debug body snippet for route issues */}
            {debugResult._debug_body_snippet && (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary">
                  <ChevronRight className="h-3 w-3" />
                  Ver respuesta upstream (primeros 2KB)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ScrollArea className="h-32 mt-2 rounded border bg-muted/30 p-2">
                    <pre className="text-[10px] font-mono whitespace-pre-wrap">
                      {debugResult._debug_body_snippet}
                    </pre>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Raw JSON */}
            {debugResult.raw && (
              <JsonViewer data={debugResult.raw} title="Ver Respuesta Raw" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Sync Results Card */}
      {(syncResults || dbResults) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Resultados de Sync (DB Write)
            </CardTitle>
            <CardDescription>
              Resultados de la sincronización con escritura a base de datos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Actuaciones sync result */}
            {syncResults?.actuaciones && (
              <div className={cn(
                "p-4 rounded-lg border",
                syncResults.actuaciones.success ? "bg-emerald-500/10 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"
              )}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium flex items-center gap-2">
                    {syncResults.actuaciones.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    Actuaciones (sync-by-work-item)
                  </h4>
                  <Badge variant={syncResults.actuaciones.success ? "secondary" : "destructive"}>
                    {syncResults.actuaciones.success ? "✅ Success" : "❌ Error"}
                  </Badge>
                </div>
                {syncResults.actuaciones.error && (
                  <p className="text-sm text-destructive mb-2">{syncResults.actuaciones.error}</p>
                )}
                {syncResults.actuaciones.data && (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 font-mono">
                    {JSON.stringify(syncResults.actuaciones.data, null, 2).slice(0, 500)}
                  </div>
                )}
              </div>
            )}

            {/* Publicaciones sync result */}
            {syncResults?.publicaciones && (
              <PublicacionesSyncResultCard 
                result={syncResults.publicaciones}
                onRetry={() => runSyncMutation.mutate()}
                isRetrying={runSyncMutation.isPending}
              />
            )}

            {/* Database results */}
            {dbResults && (
              <>
                <Separator />
                <h4 className="font-medium flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Datos en Base de Datos
                </h4>

                {/* Actuaciones in DB */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    work_item_acts: {dbResults.actuaciones.length} registros
                  </p>
                  {dbResults.actuaciones.length > 0 ? (
                    <div className="space-y-1">
                      {dbResults.actuaciones.slice(0, 5).map((act: any) => (
                        <div key={act.id} className="text-xs p-2 bg-muted/50 rounded flex justify-between">
                          <span className="font-mono">{act.act_date || 'Sin fecha'}</span>
                          <span className="truncate max-w-[300px]">{act.description?.slice(0, 50) || 'Sin descripción'}</span>
                          <Badge variant="outline" className="text-[10px]">{act.source}</Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No hay actuaciones en DB para este work_item</p>
                  )}
                </div>

                {/* Publicaciones in DB */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    work_item_publicaciones: {dbResults.publicaciones.length} registros
                  </p>
                  {dbResults.publicaciones.length > 0 ? (
                    <div className="space-y-1">
                      {dbResults.publicaciones.slice(0, 5).map((pub: any) => (
                        <div key={pub.id} className="text-xs p-2 bg-muted/50 rounded flex justify-between items-center">
                          <span className="truncate max-w-[250px]">{pub.title}</span>
                          {pub.pdf_url && (
                            <Badge variant="outline" className="text-[10px]">📄 PDF</Badge>
                          )}
                          <span className="font-mono text-muted-foreground">{pub.fecha_fijacion || '—'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No hay publicaciones en DB para este work_item</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sync History Card */}
      <SyncHistoryCard />

      {/* Stage Suggestions Debug Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Sugerencias de Etapa (Debug)
          </CardTitle>
          <CardDescription>
            Ver sugerencias pendientes para un work_item específico
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="work-item-id">Work Item ID (UUID)</Label>
              <Input
                id="work-item-id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={workItemIdForSuggestion}
                onChange={(e) => setWorkItemIdForSuggestion(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-end"
              onClick={() => refetchSuggestions()}
              disabled={suggestionsLoading || !workItemIdForSuggestion}
            >
              {suggestionsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>

          {pendingSuggestions && pendingSuggestions.length > 0 ? (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Últimas {pendingSuggestions.length} sugerencias:</h4>
              {pendingSuggestions.map((s: any) => (
                <div 
                  key={s.id} 
                  className={cn(
                    "p-3 rounded-lg border text-sm space-y-1",
                    s.status === 'PENDING' ? "bg-primary/5 border-primary/30" :
                    s.status === 'APPLIED' ? "bg-emerald-500/10 border-emerald-500/30" :
                    "bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <Badge variant={s.status === 'PENDING' ? 'default' : 'secondary'}>
                      {s.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Sugerido:</span>
                      <span className="ml-1 font-medium">{s.suggested_stage || s.suggested_pipeline_stage || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Confianza:</span>
                      <span className="ml-1 font-medium">{Math.round((s.confidence || 0) * 100)}%</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Fuente:</span>
                      <span className="ml-1">{s.source_type}</span>
                    </div>
                    {s.reason && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Razón:</span>
                        <span className="ml-1 text-xs">{s.reason?.substring(0, 100)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : workItemIdForSuggestion.length > 10 ? (
            <p className="text-sm text-muted-foreground">
              No hay sugerencias para este work_item.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Publicaciones Debug Card - Full Data Flow Verification */}
      <PublicacionesDebugCard />

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

// ============== Publicaciones Debug Card ==============

interface PublicacionesDebugStep {
  step: string;
  status: 'pending' | 'success' | 'error' | 'warning' | 'info';
  message: string;
  data?: unknown;
  timestamp?: string;
}

function PublicacionesDebugCard() {
  const [radicado, setRadicado] = useState('');
  const [workItemId, setWorkItemId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<PublicacionesDebugStep[]>([]);

  const addStep = (step: Omit<PublicacionesDebugStep, 'timestamp'>) => {
    setSteps(prev => [...prev, { ...step, timestamp: new Date().toISOString() }]);
  };

  const updateLastStep = (updates: Partial<PublicacionesDebugStep>) => {
    setSteps(prev => {
      const newSteps = [...prev];
      if (newSteps.length > 0) {
        newSteps[newSteps.length - 1] = { ...newSteps[newSteps.length - 1], ...updates };
      }
      return newSteps;
    });
  };

  const runFullDebug = async () => {
    const normalizedRadicado = radicado.replace(/\D/g, '');
    if (!normalizedRadicado || normalizedRadicado.length !== 23) {
      toast.error('Ingrese un radicado válido de 23 dígitos');
      return;
    }

    setIsRunning(true);
    setSteps([]);

    try {
      // Step 1: Test Publicaciones API via debug-external-provider
      addStep({ step: '1️⃣ API Test', status: 'pending', message: 'Llamando debug-external-provider (publicaciones)...' });
      
      const { data: apiData, error: apiError } = await supabase.functions.invoke(
        'debug-external-provider',
        {
          body: {
            provider: 'publicaciones',
            identifier: { radicado: normalizedRadicado },
            mode: 'lookup',
            timeoutMs: 15000,
          },
        }
      );

      if (apiError) {
        updateLastStep({ 
          status: 'error', 
          message: `Error Edge Function: ${apiError.message}`,
          data: apiError
        });
      } else if (apiData?.ok && apiData.summary?.found) {
        updateLastStep({ 
          status: 'success', 
          message: `API respondió OK. Publicaciones: ${apiData.summary?.publicacionesCount || 'N/A'}`,
          data: apiData
        });
      } else if (apiData?.error_code === 'RECORD_NOT_FOUND') {
        updateLastStep({ 
          status: 'warning', 
          message: 'RECORD_NOT_FOUND - Radicado no está en caché. Auto-scraping debería iniciarse.',
          data: apiData
        });
      } else {
        updateLastStep({ 
          status: 'warning', 
          message: `API respondió pero sin datos: ${apiData?.error_code || apiData?.message || 'Unknown'}`,
          data: apiData
        });
      }

      // Step 2: Check work_item_publicaciones table
      addStep({ step: '2️⃣ BD: work_item_publicaciones', status: 'pending', message: 'Buscando en tabla work_item_publicaciones...' });
      
      // First find work_item with this radicado
      const { data: workItems } = await supabase
        .from('work_items')
        .select('id, radicado, workflow_type, authority_name')
        .eq('radicado', normalizedRadicado)
        .limit(5);

      if (!workItems || workItems.length === 0) {
        updateLastStep({ 
          status: 'info', 
          message: 'No hay work_item con este radicado. Cree uno primero para sincronizar.',
          data: { radicado: normalizedRadicado }
        });
      } else {
        const wiId = workItems[0].id;
        setWorkItemId(wiId);
        
        const { data: pubData, error: pubError } = await supabase
          .from('work_item_publicaciones')
          .select('*')
          .eq('work_item_id', wiId)
          .order('published_at', { ascending: false })
          .limit(10);

        if (pubError) {
          updateLastStep({ 
            status: 'error', 
            message: `Error consultando tabla: ${pubError.message}`,
            data: pubError
          });
        } else if (pubData && pubData.length > 0) {
          updateLastStep({ 
            status: 'success', 
            message: `✅ ${pubData.length} publicaciones en BD para este work_item`,
            data: { work_item_id: wiId, publicaciones: pubData }
          });
        } else {
          updateLastStep({ 
            status: 'warning', 
            message: `0 publicaciones en BD para work_item ${wiId.slice(0, 8)}...`,
            data: { work_item_id: wiId, work_item: workItems[0] }
          });
        }

        // Step 3: Try to sync if work_item exists
        addStep({ step: '3️⃣ Sync: sync-publicaciones-by-work-item', status: 'pending', message: `Ejecutando sync para work_item ${wiId.slice(0, 8)}...` });
        
        const { data: syncData, error: syncError } = await supabase.functions.invoke(
          'sync-publicaciones-by-work-item',
          { body: { work_item_id: wiId } }
        );

        if (syncError) {
          updateLastStep({ 
            status: 'error', 
            message: `Error sync: ${syncError.message}`,
            data: syncError
          });
        } else if (syncData?.ok) {
          updateLastStep({ 
            status: 'success', 
            message: `Sync OK. Insertados: ${syncData.inserted_count}, Omitidos: ${syncData.skipped_count}`,
            data: syncData
          });
        } else {
          updateLastStep({ 
            status: 'warning', 
            message: `Sync completó con errores: ${syncData?.errors?.join(', ') || syncData?.code || 'Unknown'}`,
            data: syncData
          });
        }

        // Step 4: Verify data after sync
        addStep({ step: '4️⃣ Verificación post-sync', status: 'pending', message: 'Re-consultando work_item_publicaciones...' });
        
        const { data: postSyncData } = await supabase
          .from('work_item_publicaciones')
          .select('id, title, annotation, published_at, source')
          .eq('work_item_id', wiId)
          .order('published_at', { ascending: false })
          .limit(10);

        updateLastStep({ 
          status: (postSyncData?.length || 0) > 0 ? 'success' : 'warning', 
          message: `${postSyncData?.length || 0} publicaciones en BD después de sync`,
          data: postSyncData
        });
      }

      // Step 5: Check sync_traces if table exists
      // NOTE: sync_traces table has 'meta' column (JSONB), NOT 'metadata'
      addStep({ step: '5️⃣ Sync Traces', status: 'pending', message: 'Buscando trazas de sync...' });
      
      // Query sync_traces by work_item_id (more reliable than radicado search)
      let tracesQuery;
      if (workItemId) {
        // Primary: filter by work_item_id directly
        tracesQuery = supabase
          .from('sync_traces')
          .select('*')
          .eq('work_item_id', workItemId)
          .order('created_at', { ascending: false })
          .limit(20);
      } else {
        // Fallback: just get recent traces (we don't have metadata to search)
        tracesQuery = supabase
          .from('sync_traces')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);
      }

      const { data: traces, error: tracesError } = await tracesQuery;

      if (tracesError) {
        updateLastStep({ 
          status: 'info', 
          message: `No se pudo consultar sync_traces: ${tracesError.message}`,
          data: tracesError
        });
      } else {
        // Filter for publicaciones-related traces
        const pubTraces = traces?.filter((t: any) => 
          t.step?.toLowerCase().includes('publicacion') || 
          t.provider?.toLowerCase().includes('publicacion') ||
          t.step === 'SYNC_START' || 
          t.step === 'SYNC_SUCCESS' ||
          t.step === 'SYNC_FAILED'
        );
        updateLastStep({ 
          status: pubTraces && pubTraces.length > 0 ? 'success' : 'info', 
          message: workItemId 
            ? `${pubTraces?.length || 0} trazas encontradas para work_item` 
            : `${pubTraces?.length || 0} trazas recientes (sin work_item_id para filtrar)`,
          data: pubTraces || traces
        });
      }

    } catch (err) {
      addStep({ 
        step: 'Error', 
        status: 'error', 
        message: `Error general: ${err instanceof Error ? err.message : String(err)}`,
        data: err
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStepIcon = (status: PublicacionesDebugStep['status']) => {
    switch (status) {
      case 'pending': return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'info': return <AlertTriangle className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          🔍 Debug: Publicaciones Procesales (Flujo Completo)
        </CardTitle>
        <CardDescription>
          Verifica el flujo completo: API externa → Edge Function → Base de datos → UI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="pub-radicado">Radicado (23 dígitos)</Label>
            <Input
              id="pub-radicado"
              placeholder="05376311200120230029200"
              value={radicado}
              onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
              maxLength={23}
              inputMode="numeric"
              className="font-mono"
            />
            {radicado && radicado.length !== 23 && (
              <p className="text-xs text-destructive mt-1">{radicado.length}/23 dígitos</p>
            )}
          </div>
          <Button 
            onClick={runFullDebug} 
            disabled={isRunning || radicado.length !== 23}
            className="self-end"
          >
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Ejecutar Debug Completo
          </Button>
        </div>

        {steps.length > 0 && (
          <div className="space-y-3 mt-4">
            {steps.map((step, idx) => (
              <div 
                key={idx} 
                className={cn(
                  "p-3 rounded-lg border",
                  step.status === 'success' && "bg-emerald-500/10 border-emerald-500/30",
                  step.status === 'error' && "bg-destructive/10 border-destructive/30",
                  step.status === 'warning' && "bg-amber-500/10 border-amber-500/30",
                  step.status === 'info' && "bg-blue-500/10 border-blue-500/30",
                  step.status === 'pending' && "bg-muted/50"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  {getStepIcon(step.status)}
                  <span className="font-medium text-sm">{step.step}</span>
                  {step.timestamp && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{step.message}</p>
                
                {step.data && (
                  <Collapsible className="mt-2">
                    <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                      <ChevronRight className="h-3 w-3" />
                      Ver datos raw
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ScrollArea className="h-40 mt-2 rounded border bg-muted/30 p-2">
                        <pre className="text-[10px] font-mono whitespace-pre-wrap">
                          {JSON.stringify(step.data, null, 2)}
                        </pre>
                      </ScrollArea>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            ))}
          </div>
        )}

        {workItemId && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground">Work Item ID detectado:</p>
            <code className="text-xs font-mono">{workItemId}</code>
            <Button 
              variant="link" 
              size="sm" 
              className="ml-2 h-auto p-0"
              onClick={() => window.open(`/app/work-items/${workItemId}?tab=acts`, '_blank')}
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Ver en UI
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
