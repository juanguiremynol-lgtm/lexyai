import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { 
  Loader2, Play, CheckCircle2, XCircle, AlertTriangle, Clock, 
  ExternalLink, Copy, RefreshCw, Bug, Eye 
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface AttemptLog {
  phase: string;
  url: string;
  method: string;
  status: number | null;
  latency_ms: number;
  error_type?: string;
  response_snippet_1kb?: string;
  success: boolean;
}

interface TestResult {
  adapter: string;
  ok: boolean;
  run_id?: string;
  classification?: string;
  http_status?: number;
  error?: string;
  results?: unknown[];
  events?: unknown[];
  duration_ms?: number;
  raw_response?: any;
  attempts?: AttemptLog[];
  why_empty?: string;
}

const CLASSIFICATION_COLORS: Record<string, string> = {
  'SUCCESS': 'bg-green-500',
  'NO_RESULTS_CONFIRMED': 'bg-yellow-500',
  'ENDPOINT_404': 'bg-red-500',
  'ENDPOINT_CHANGED': 'bg-red-500',
  'BLOCKED_403_429': 'bg-orange-500',
  'NON_JSON_RESPONSE': 'bg-purple-500',
  'PARSE_BROKE': 'bg-amber-500',
  'INTERACTION_REQUIRED': 'bg-blue-500',
  'INTERACTION_FAILED_SELECTOR_CHANGED': 'bg-rose-500',
  'UNKNOWN': 'bg-muted',
};

export default function ProcessStatusTest() {
  const [radicado, setRadicado] = useState("05001400300220250105400");
  const [debugMode, setDebugMode] = useState(true);
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
      
      console.log(`Testing ${adapter} with radicado: ${radicado}, debug: ${debugMode}`);

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {
          action: 'search',
          radicado,
          owner_id: user.id,
          debug: debugMode,
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
            ok: data.ok !== false,
            run_id: data.run_id,
            classification: data.classification,
            http_status: data.http_status,
            error: data.error,
            results: data.results,
            events: data.events,
            duration_ms,
            raw_response: data,
            attempts: data.attempts,
            why_empty: data.why_empty,
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  const getStatusIcon = (result?: TestResult) => {
    if (!result) return <Clock className="h-5 w-5 text-muted-foreground" />;
    if (result.ok && result.classification === 'SUCCESS') return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (result.ok) return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    return <XCircle className="h-5 w-5 text-destructive" />;
  };

  const adapters = ['CPNU', 'PUBLICACIONES', 'HISTORICO', 'PIPELINE'];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <Bug className="h-6 w-6" />
          Test Harness - Diagnóstico de Crawlers
        </h1>
        <p className="text-muted-foreground">
          Pruebe cada adapter individualmente con diagnósticos detallados
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración de Prueba</CardTitle>
          <CardDescription>
            Ingrese un radicado de 23 dígitos para probar los adapters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="radicado">Radicado de Prueba</Label>
              <Input
                id="radicado"
                value={radicado}
                onChange={(e) => setRadicado(e.target.value)}
                placeholder="23 dígitos"
                className="font-mono"
                maxLength={23}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {radicado.replace(/\D/g, '').length} / 23 dígitos
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch 
                id="debug-mode" 
                checked={debugMode} 
                onCheckedChange={setDebugMode} 
              />
              <Label htmlFor="debug-mode">
                Modo Debug (incluir intentos en respuesta)
              </Label>
            </div>
          </div>
          
          <Separator />
          
          <div className="flex gap-2 flex-wrap">
            {adapters.map((adapter) => (
              <Button
                key={adapter}
                onClick={() => runTest(adapter)}
                disabled={isRunning[adapter]}
                variant={adapter === 'CPNU' ? 'default' : 'outline'}
                size="lg"
              >
                {isRunning[adapter] ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Test {adapter}
              </Button>
            ))}
            <Button
              variant="secondary"
              onClick={() => {
                adapters.forEach(a => runTest(a));
              }}
              disabled={Object.values(isRunning).some(v => v)}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Test All
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {adapters.map((adapter) => {
          const result = results[adapter];
          return (
            <Card key={adapter} className={result?.ok === false ? 'border-destructive/50' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(result)}
                    <CardTitle className="text-lg">{adapter}</CardTitle>
                    {result?.duration_ms && (
                      <Badge variant="outline">{result.duration_ms}ms</Badge>
                    )}
                    {result?.classification && (
                      <Badge className={CLASSIFICATION_COLORS[result.classification] || 'bg-muted'}>
                        {result.classification}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {result?.run_id && (
                      <>
                        <Link to={`/process-status/diagnostics/${result.run_id}`}>
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Ver Diagnóstico
                          </Button>
                        </Link>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => copyToClipboard(result.run_id!)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!result ? (
                  <p className="text-sm text-muted-foreground">No ejecutado aún</p>
                ) : (
                  <Tabs defaultValue="summary" className="w-full">
                    <TabsList>
                      <TabsTrigger value="summary">Resumen</TabsTrigger>
                      {result.attempts && result.attempts.length > 0 && (
                        <TabsTrigger value="attempts">
                          Intentos ({result.attempts.length})
                        </TabsTrigger>
                      )}
                      <TabsTrigger value="results">
                        Resultados ({Array.isArray(result.results) ? result.results.length : 0})
                      </TabsTrigger>
                      <TabsTrigger value="raw">JSON Raw</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="summary" className="space-y-3">
                      {result.ok ? (
                        <Alert>
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertTitle>
                            {result.classification === 'SUCCESS' ? 'Éxito' : 'Completado'}
                          </AlertTitle>
                          <AlertDescription>
                            {Array.isArray(result.results) && `${result.results.length} resultado(s) encontrado(s). `}
                            {Array.isArray(result.events) && `${result.events.length} evento(s).`}
                            {result.why_empty && (
                              <span className="block text-xs mt-1">
                                Nota: {result.why_empty}
                              </span>
                            )}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertTitle>Error</AlertTitle>
                          <AlertDescription className="space-y-1">
                            <p>{result.error}</p>
                            {result.why_empty && (
                              <p className="text-xs font-semibold">Razón: {result.why_empty}</p>
                            )}
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div className="p-2 bg-muted rounded">
                          <p className="text-muted-foreground">Run ID</p>
                          <p className="font-mono text-xs truncate">{result.run_id || 'N/A'}</p>
                        </div>
                        <div className="p-2 bg-muted rounded">
                          <p className="text-muted-foreground">Classification</p>
                          <p className="font-medium">{result.classification || 'N/A'}</p>
                        </div>
                        <div className="p-2 bg-muted rounded">
                          <p className="text-muted-foreground">Intentos</p>
                          <p className="font-medium">{result.attempts?.length || 0}</p>
                        </div>
                        <div className="p-2 bg-muted rounded">
                          <p className="text-muted-foreground">Duración</p>
                          <p className="font-medium">{result.duration_ms}ms</p>
                        </div>
                      </div>
                    </TabsContent>
                    
                    <TabsContent value="attempts">
                      {result.attempts && result.attempts.length > 0 ? (
                        <ScrollArea className="h-80">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Phase</TableHead>
                                <TableHead>URL</TableHead>
                                <TableHead>Method</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Latency</TableHead>
                                <TableHead>Error</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.attempts.map((attempt, i) => (
                                <TableRow key={i} className={attempt.success ? 'bg-green-500/10' : 'bg-red-500/10'}>
                                  <TableCell>
                                    <Badge variant="outline">{attempt.phase}</Badge>
                                  </TableCell>
                                  <TableCell className="max-w-[300px]">
                                    <p className="font-mono text-xs truncate" title={attempt.url}>
                                      {attempt.url}
                                    </p>
                                  </TableCell>
                                  <TableCell>{attempt.method}</TableCell>
                                  <TableCell>
                                    <Badge variant={attempt.status && attempt.status < 400 ? 'secondary' : 'destructive'}>
                                      {attempt.status || 'N/A'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>{attempt.latency_ms}ms</TableCell>
                                  <TableCell>
                                    {attempt.error_type && (
                                      <Badge variant="destructive">{attempt.error_type}</Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          
                          {/* Show response snippets */}
                          {result.attempts.some(a => a.response_snippet_1kb) && (
                            <div className="mt-4 space-y-2">
                              <h4 className="font-semibold text-sm">Response Snippets</h4>
                              {result.attempts.filter(a => a.response_snippet_1kb).map((attempt, i) => (
                                <div key={i} className="p-2 bg-muted rounded text-xs">
                                  <p className="font-semibold">{attempt.phase} - {attempt.url.substring(0, 50)}...</p>
                                  <pre className="mt-1 whitespace-pre-wrap break-all">
                                    {attempt.response_snippet_1kb?.substring(0, 500)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </ScrollArea>
                      ) : (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No hay intentos registrados. Habilite el modo debug.
                        </p>
                      )}
                    </TabsContent>
                    
                    <TabsContent value="results">
                      <ScrollArea className="h-64">
                        {Array.isArray(result.results) && result.results.length > 0 ? (
                          <div className="space-y-2">
                            {result.results.map((r: any, i) => (
                              <div key={i} className="p-3 bg-muted rounded">
                                <p className="font-mono text-sm">{r.radicado}</p>
                                <p className="text-sm">{r.despacho}</p>
                                {r.id_proceso && (
                                  <Badge variant="secondary" className="mt-1">
                                    idProceso: {r.id_proceso}
                                  </Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground text-center py-4">
                            Sin resultados
                          </p>
                        )}
                        
                        {Array.isArray(result.events) && result.events.length > 0 && (
                          <div className="mt-4">
                            <h4 className="font-semibold mb-2">Eventos ({result.events.length})</h4>
                            {result.events.slice(0, 5).map((e: any, i) => (
                              <div key={i} className="p-2 bg-muted/50 rounded mb-1 text-sm">
                                <p className="font-medium">{e.title}</p>
                                <p className="text-xs text-muted-foreground">{e.event_date}</p>
                              </div>
                            ))}
                            {result.events.length > 5 && (
                              <p className="text-xs text-muted-foreground">
                                + {result.events.length - 5} más
                              </p>
                            )}
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>
                    
                    <TabsContent value="raw">
                      <div className="flex justify-end mb-2 gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => copyToClipboard(JSON.stringify(result.raw_response, null, 2))}
                        >
                          <Copy className="h-4 w-4 mr-1" />
                          Copy JSON
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const blob = new Blob([JSON.stringify(result.raw_response, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `fixture_raw_${result.adapter}_${Date.now()}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                            toast.success("Fixture descargado");
                          }}
                        >
                          Export Raw Fixture
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const redact = (data: unknown): unknown => {
                              if (!data || typeof data !== 'object') return data;
                              if (typeof data === 'string') {
                                return data
                                  .replace(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+){2,}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/g, 'NOMBRE_TEST')
                                  .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'email@test.com');
                              }
                              if (Array.isArray(data)) return data.map(redact);
                              const result: Record<string, unknown> = {};
                              for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
                                if (['demandante', 'demandado', 'nombre', 'cedula'].some(f => key.toLowerCase().includes(f))) {
                                  result[key] = 'REDACTED_TEST';
                                } else {
                                  result[key] = redact(value);
                                }
                              }
                              return result;
                            };
                            const redacted = redact(result.raw_response);
                            const blob = new Blob([JSON.stringify(redacted, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `fixture_redacted_${result.adapter}_${Date.now()}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                            toast.success("Fixture redactado descargado");
                          }}
                        >
                          Export Redacted Fixture
                        </Button>
                      </div>
                      <ScrollArea className="h-64 rounded border">
                        <pre className="text-xs p-3">
                          {JSON.stringify(result.raw_response, null, 2)}
                        </pre>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
