/**
 * Route Discovery Panel
 * 
 * Probes all API endpoints for a given provider and displays results.
 * Used in the Debug Console / Atenia AI admin panel.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Loader2, CheckCircle, XCircle, AlertTriangle, Search, 
  ChevronDown, Lock, Globe, FileText 
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type ProviderName = 'cpnu' | 'samai' | 'tutelas' | 'publicaciones';

interface ProbeResult {
  path: string;
  status: number;
  statusText: string;
  contentType: string;
  bodyPreview: string;
  bodyLength: number;
  durationMs: number;
  isJson: boolean;
}

interface ProbeResponse {
  ok: boolean;
  provider: string;
  base_url_masked: string;
  summary: {
    total_probed: number;
    live_routes: number;
    auth_required: number;
    not_found: number;
    server_errors: number;
    timeouts: number;
  };
  live_routes: Array<{ path: string; status: number; contentType: string; durationMs: number }>;
  auth_required: Array<{ path: string; status: number }>;
  openapi_endpoints: string[];
  full_results: ProbeResult[];
  error?: string;
}

const PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: 'cpnu', label: 'CPNU' },
  { id: 'samai', label: 'SAMAI' },
  { id: 'publicaciones', label: 'Publicaciones' },
  { id: 'tutelas', label: 'Tutelas' },
];

export function RouteDiscoveryPanel() {
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>('tutelas');
  const [isProbing, setIsProbing] = useState(false);
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const runProbe = async () => {
    setIsProbing(true);
    setResult(null);
    setShowDetails(false);

    try {
      const { data, error } = await supabase.functions.invoke('debug-external-provider', {
        body: { provider: selectedProvider, mode: 'probe_routes', identifier: {} }
      });

      if (error) {
        setResult({ ok: false, error: error.message } as any);
      } else {
        setResult(data as ProbeResponse);
      }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message } as any);
    } finally {
      setIsProbing(false);
    }
  };

  const getStatusIcon = (status: number) => {
    if (status >= 200 && status < 400) return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
    if (status === 401 || status === 403) return <Lock className="h-3.5 w-3.5 text-amber-500" />;
    if (status === 404) return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
    if (status >= 500) return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
    return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" />
          Descubrimiento de Rutas API
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          {PROVIDERS.map(p => (
            <Button
              key={p.id}
              variant={selectedProvider === p.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setSelectedProvider(p.id); setResult(null); }}
            >
              {p.label}
            </Button>
          ))}
          <Button onClick={runProbe} disabled={isProbing} size="sm" className="ml-auto">
            {isProbing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />}
            Descubrir Rutas
          </Button>
        </div>

        {result && result.ok && result.summary && (
          <div className="space-y-3">
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{result.summary.total_probed} rutas probadas</Badge>
              {result.summary.live_routes > 0 && (
                <Badge className="bg-green-500/15 text-green-700 border-green-500/30">
                  ✅ {result.summary.live_routes} activas
                </Badge>
              )}
              {result.summary.auth_required > 0 && (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">
                  🔒 {result.summary.auth_required} requieren auth
                </Badge>
              )}
              {result.summary.not_found > 0 && (
                <Badge variant="secondary">❌ {result.summary.not_found} no encontradas</Badge>
              )}
              {result.summary.server_errors > 0 && (
                <Badge variant="destructive">{result.summary.server_errors} errores servidor</Badge>
              )}
              {result.summary.timeouts > 0 && (
                <Badge variant="secondary">⏱ {result.summary.timeouts} timeouts</Badge>
              )}
            </div>

            {/* Live routes */}
            {result.live_routes.length > 0 && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Globe className="h-4 w-4 text-green-600" />
                  Rutas activas
                </h4>
                <div className="space-y-1">
                  {result.live_routes.map(r => (
                    <div key={r.path} className="flex items-center gap-2 text-xs font-mono">
                      <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                      <span className="font-semibold">{r.path}</span>
                      <span className="text-muted-foreground">→ {r.status}</span>
                      <span className="text-muted-foreground">({r.contentType.split(';')[0]})</span>
                      <span className="text-muted-foreground">{r.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auth required routes */}
            {result.auth_required.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-amber-600" />
                  Requieren autenticación
                </h4>
                <div className="space-y-1">
                  {result.auth_required.map(r => (
                    <div key={r.path} className="flex items-center gap-2 text-xs font-mono">
                      <Lock className="h-3 w-3 text-amber-500 flex-shrink-0" />
                      <span>{r.path}</span>
                      <span className="text-muted-foreground">→ {r.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OpenAPI endpoints */}
            {result.openapi_endpoints.length > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-primary" />
                  Endpoints según OpenAPI
                </h4>
                <div className="space-y-1">
                  {result.openapi_endpoints.map((ep, i) => (
                    <div key={i} className="text-xs font-mono text-foreground">{ep}</div>
                  ))}
                </div>
              </div>
            )}

            {result.live_routes.length === 0 && result.openapi_endpoints.length === 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">⚠️ No se encontraron rutas activas</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  El servicio puede no estar desplegado, o requiere rutas/autenticación diferentes.
                  Verifique la configuración de {selectedProvider.toUpperCase()}_BASE_URL.
                </p>
              </div>
            )}

            {/* Full results (collapsible) */}
            <Collapsible open={showDetails} onOpenChange={setShowDetails}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full text-xs">
                  <ChevronDown className={cn("h-3 w-3 mr-1 transition-transform", showDetails && "rotate-180")} />
                  {showDetails ? 'Ocultar' : 'Ver'} todos los resultados ({result.full_results.length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded border bg-muted/50 divide-y">
                  {result.full_results.map(r => (
                    <div key={r.path} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                      {getStatusIcon(r.status)}
                      <span className="font-mono font-medium w-40 truncate">{r.path}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {r.status || r.statusText}
                      </Badge>
                      <span className="text-muted-foreground truncate flex-1">
                        {r.bodyPreview.slice(0, 80)}
                      </span>
                      <span className="text-muted-foreground">{r.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {result && !result.ok && result.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Error: {result.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
