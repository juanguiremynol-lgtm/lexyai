import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Play, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface TestResult {
  adapter: string;
  ok: boolean;
  run_id?: string;
  http_status?: number;
  error?: string;
  results?: unknown[];
  events?: unknown[];
  duration_ms?: number;
  raw_response?: unknown;
  search_url?: string;
  why_empty?: string;
}

export default function ProcessStatusTest() {
  const [radicado, setRadicado] = useState("05001400300220250105400");
  const [isRunning, setIsRunning] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const runTest = async (adapter: string) => {
    setIsRunning(prev => ({ ...prev, [adapter]: true }));
    const startTime = Date.now();

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Debe iniciar sesión");
        return;
      }

      let functionName = '';
      if (adapter === 'CPNU') functionName = 'adapter-cpnu';
      else if (adapter === 'PUBLICACIONES') functionName = 'adapter-publicaciones';
      else if (adapter === 'HISTORICO') functionName = 'adapter-historico';
      else if (adapter === 'PIPELINE') functionName = 'process-monitor';
      
      console.log(`Testing ${adapter} with radicado: ${radicado}`);

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          action: 'search',
          radicado,
          owner_id: user.id,
        },
      });

      const duration_ms = Date.now() - startTime;

      if (error) {
        setResults(prev => ({
          ...prev,
          [adapter]: {
            adapter,
            ok: false,
            error: error.message,
            duration_ms,
          },
        }));
      } else {
        setResults(prev => ({
          ...prev,
          [adapter]: {
            adapter,
            ok: data.ok !== false && data.success !== false,
            run_id: data.run_id,
            http_status: data.http_status,
            error: data.error,
            results: data.results,
            events: data.events,
            duration_ms,
            raw_response: data,
          },
        }));
      }
    } catch (e) {
      setResults(prev => ({
        ...prev,
        [adapter]: {
          adapter,
          ok: false,
          error: e instanceof Error ? e.message : 'Unknown error',
          duration_ms: Date.now() - startTime,
        },
      }));
    } finally {
      setIsRunning(prev => ({ ...prev, [adapter]: false }));
    }
  };

  const getStatusIcon = (result?: TestResult) => {
    if (!result) return <Clock className="h-5 w-5 text-muted-foreground" />;
    if (result.ok) return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    return <XCircle className="h-5 w-5 text-destructive" />;
  };

  const adapters = ['CPNU', 'PUBLICACIONES', 'HISTORICO', 'PIPELINE'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold">Test Harness - Diagnóstico de Crawlers</h1>
        <p className="text-muted-foreground">
          Pruebe cada adapter individualmente para diagnosticar problemas
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración de Prueba</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Label htmlFor="radicado">Radicado de Prueba</Label>
            <Input
              id="radicado"
              value={radicado}
              onChange={(e) => setRadicado(e.target.value)}
              placeholder="23 dígitos"
              className="font-mono"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {adapters.map((adapter) => (
              <Button
                key={adapter}
                onClick={() => runTest(adapter)}
                disabled={isRunning[adapter]}
                variant={adapter === 'PIPELINE' ? 'default' : 'outline'}
              >
                {isRunning[adapter] ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Test {adapter}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {adapters.map((adapter) => {
          const result = results[adapter];
          return (
            <Card key={adapter}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(result)}
                    <CardTitle className="text-lg">{adapter}</CardTitle>
                    {result?.duration_ms && (
                      <Badge variant="outline">{result.duration_ms}ms</Badge>
                    )}
                  </div>
                  {result?.run_id && (
                    <Link to={`/process-status/diagnostics/${result.run_id}`}>
                      <Badge variant="secondary" className="cursor-pointer">
                        Run: {result.run_id.substring(0, 8)}...
                      </Badge>
                    </Link>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!result ? (
                  <p className="text-sm text-muted-foreground">No ejecutado aún</p>
                ) : result.ok ? (
                  <div className="space-y-2">
                    <Alert>
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertTitle>Éxito</AlertTitle>
                      <AlertDescription>
                        {Array.isArray(result.results) && `${result.results.length} resultado(s) encontrado(s). `}
                        {Array.isArray(result.events) && `${result.events.length} evento(s).`}
                        {(result.raw_response as any)?.why_empty === 'SPA_REQUIRES_INTERACTION' && (
                          <span className="block text-xs mt-1 text-amber-600">
                            ⚠️ El portal CPNU requiere interacción de formulario JavaScript.
                            El scraping directo no puede ejecutar la búsqueda.
                          </span>
                        )}
                        {(result.raw_response as any)?.why_empty && 
                         (result.raw_response as any)?.why_empty !== 'SPA_REQUIRES_INTERACTION' && (
                          <span className="block text-xs mt-1">Nota: {(result.raw_response as any).why_empty}</span>
                        )}
                      </AlertDescription>
                    </Alert>
                    {result.run_id && (
                      <Link to={`/process-status/diagnostics/${result.run_id}`}>
                        <Button variant="outline" size="sm">
                          Ver diagnóstico
                        </Button>
                      </Link>
                    )}
                    <ScrollArea className="h-48 rounded border p-2">
                      <pre className="text-xs">{JSON.stringify(result.raw_response, null, 2)}</pre>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Error</AlertTitle>
                      <AlertDescription className="space-y-1">
                        <p>{result.error}</p>
                        {result.http_status && <p className="text-xs">HTTP Status: {result.http_status}</p>}
                        {(result.raw_response as any)?.why_empty && (
                          <p className="text-xs">Razón: {(result.raw_response as any).why_empty}</p>
                        )}
                        {(result.raw_response as any)?.search_url && (
                          <p className="text-xs font-mono break-all">URL: {(result.raw_response as any).search_url}</p>
                        )}
                      </AlertDescription>
                    </Alert>
                    {result.run_id && (
                      <Link to={`/process-status/diagnostics/${result.run_id}`}>
                        <Button variant="outline" size="sm" className="w-full">
                          Ver diagnóstico completo
                        </Button>
                      </Link>
                    )}
                    {result.raw_response && (
                      <ScrollArea className="h-32 rounded border p-2">
                        <pre className="text-xs">{JSON.stringify(result.raw_response, null, 2)}</pre>
                      </ScrollArea>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
