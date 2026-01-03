import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { API_BASE_URL } from "@/config/api";
import { adapterRegistry } from "@/lib/scraping/adapter-registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Server,
  Activity,
  Database,
  Globe,
  Terminal,
  Bug,
  FileJson,
  Copy,
  Trash2,
  Search,
  Loader2,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// ============== Types ==============

interface TestStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  duration?: number;
  data?: unknown;
  errorCode?: string;
}

interface TestRun {
  id: string;
  radicado: string;
  adapter: string;
  startedAt: Date;
  finishedAt?: Date;
  status: 'running' | 'success' | 'error';
  steps: TestStep[];
  result?: unknown;
  error?: string;
}

interface ServiceStatus {
  name: string;
  url: string;
  status: 'checking' | 'online' | 'offline' | 'degraded';
  latency?: number;
  lastChecked?: Date;
  error?: string;
}

interface CrawlerRunRow {
  id: string;
  radicado: string;
  adapter: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  duration_ms: number | null;
}

// ============== Constants ==============

const SERVICES: Omit<ServiceStatus, 'status' | 'latency' | 'lastChecked'>[] = [
  { name: 'Rama Judicial API (Render)', url: API_BASE_URL },
  { name: 'Supabase API', url: import.meta.env.VITE_SUPABASE_URL || '' },
];

const FLOW_STAGES = [
  { id: 'validate', name: 'Validar Formato', description: 'Verificar que el radicado tenga 23 dígitos' },
  { id: 'lookup', name: 'Lookup', description: 'Buscar el proceso en la fuente externa' },
  { id: 'scrape', name: 'Scrape', description: 'Extraer actuaciones y metadata' },
  { id: 'normalize', name: 'Normalizar', description: 'Procesar y estandarizar datos' },
  { id: 'store', name: 'Almacenar', description: 'Guardar en base de datos' },
  { id: 'milestones', name: 'Hitos', description: 'Detectar y crear hitos automáticos' },
  { id: 'alerts', name: 'Alertas', description: 'Generar alertas y notificaciones' },
];

// ============== Component ==============

export default function ApiDebugPage() {
  const [testRadicado, setTestRadicado] = useState("05001400301520240193000");
  const [selectedAdapter, setSelectedAdapter] = useState("external-rama-judicial-api");
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Get registered adapters
  const adapters = adapterRegistry.listAll();

  // Recent crawler runs from DB
  const { data: recentRuns, refetch: refetchRuns } = useQuery({
    queryKey: ["debug-crawler-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crawler_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as CrawlerRunRow[];
    },
  });

  // Error summary by code
  const errorSummary = recentRuns?.reduce((acc, run) => {
    if (run.error_code) {
      acc[run.error_code] = (acc[run.error_code] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>) || {};

  // Check service status
  const checkServices = useCallback(async () => {
    const updatedServices: ServiceStatus[] = [];

    for (const service of SERVICES) {
      const startTime = Date.now();
      try {
        const response = await fetch(service.url, {
          method: 'HEAD',
          mode: 'no-cors',
        });
        updatedServices.push({
          ...service,
          status: 'online',
          latency: Date.now() - startTime,
          lastChecked: new Date(),
        });
      } catch (err) {
        updatedServices.push({
          ...service,
          status: 'offline',
          latency: Date.now() - startTime,
          lastChecked: new Date(),
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    setServices(updatedServices);
  }, []);

  // Initial service check
  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 60000);
    return () => clearInterval(interval);
  }, [checkServices]);

  // Run debug test
  const runDebugTest = async () => {
    if (!testRadicado.trim() || isRunning) return;

    setIsRunning(true);

    const runId = `test-${Date.now()}`;
    const run: TestRun = {
      id: runId,
      radicado: testRadicado.replace(/\D/g, ''),
      adapter: selectedAdapter,
      startedAt: new Date(),
      status: 'running',
      steps: FLOW_STAGES.map(s => ({ name: s.id, status: 'pending' as const })),
    };

    setCurrentRun(run);
    setTestRuns(prev => [run, ...prev.slice(0, 19)]);

    const updateStep = (stepId: string, update: Partial<TestStep>) => {
      setCurrentRun(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          steps: prev.steps.map(s => s.name === stepId ? { ...s, ...update } : s),
        };
      });
    };

    try {
      // Step 1: Validate
      const validateStart = Date.now();
      updateStep('validate', { status: 'running' });
      
      const cleanRadicado = testRadicado.replace(/\D/g, '');
      if (cleanRadicado.length !== 23) {
        updateStep('validate', {
          status: 'error',
          message: `Formato inválido: ${cleanRadicado.length}/23 dígitos`,
          errorCode: 'INVALID_FORMAT',
          duration: Date.now() - validateStart,
        });
        throw new Error('INVALID_FORMAT');
      }
      
      updateStep('validate', {
        status: 'success',
        message: `Radicado válido: ${cleanRadicado}`,
        duration: Date.now() - validateStart,
      });

      // Step 2: Lookup
      const lookupStart = Date.now();
      updateStep('lookup', { status: 'running' });
      
      const adapter = adapterRegistry.getById(selectedAdapter) || adapterRegistry.getDefault();
      const lookupResult = await adapter.lookup(cleanRadicado);

      updateStep('lookup', {
        status: lookupResult.status === 'FOUND' ? 'success' : 'error',
        message: lookupResult.status === 'FOUND' 
          ? `Encontrado: ${lookupResult.matches.length} coincidencia(s)`
          : lookupResult.errorMessage || 'No encontrado',
        errorCode: lookupResult.errorCode,
        duration: Date.now() - lookupStart,
        data: lookupResult,
      });

      if (lookupResult.status !== 'FOUND') {
        throw new Error(lookupResult.errorCode || 'LOOKUP_FAILED');
      }

      // Step 3: Scrape
      const scrapeStart = Date.now();
      updateStep('scrape', { status: 'running' });
      
      const match = lookupResult.matches[0];
      const scrapeResult = await adapter.scrapeCase(match);

      updateStep('scrape', {
        status: scrapeResult.status === 'SUCCESS' ? 'success' : 'error',
        message: scrapeResult.status === 'SUCCESS'
          ? `Actuaciones: ${scrapeResult.actuaciones.length}`
          : scrapeResult.errorMessage || 'Error en scraping',
        errorCode: scrapeResult.errorCode,
        duration: Date.now() - scrapeStart,
        data: scrapeResult,
      });

      if (scrapeResult.status !== 'SUCCESS') {
        throw new Error(scrapeResult.errorCode || 'SCRAPE_FAILED');
      }

      // Step 4: Normalize
      const normalizeStart = Date.now();
      updateStep('normalize', { status: 'running' });
      
      const normalized = adapter.normalizeActuaciones(scrapeResult.actuaciones, match.sourceUrl);
      
      updateStep('normalize', {
        status: 'success',
        message: `Normalizados: ${normalized.length} actuaciones`,
        duration: Date.now() - normalizeStart,
        data: { count: normalized.length, sample: normalized.slice(0, 3) },
      });

      // Step 5: Store (simulated - don't actually store in debug)
      const storeStart = Date.now();
      updateStep('store', { status: 'running' });
      
      // Simulate DB check
      await new Promise(r => setTimeout(r, 100));
      
      updateStep('store', {
        status: 'success',
        message: `Listo para almacenar ${normalized.length} registros (simulado)`,
        duration: Date.now() - storeStart,
      });

      // Step 6: Milestones (simulated)
      const milestonesStart = Date.now();
      updateStep('milestones', { status: 'running' });
      
      const detectedTypes = normalized
        .filter(n => n.actTypeGuess)
        .map(n => n.actTypeGuess);
      
      updateStep('milestones', {
        status: 'success',
        message: `Tipos detectados: ${[...new Set(detectedTypes)].join(', ') || 'Ninguno'}`,
        duration: Date.now() - milestonesStart,
        data: { types: [...new Set(detectedTypes)] },
      });

      // Step 7: Alerts (simulated)
      const alertsStart = Date.now();
      updateStep('alerts', { status: 'running' });
      await new Promise(r => setTimeout(r, 50));
      
      updateStep('alerts', {
        status: 'success',
        message: `Alertas configuradas (simulado)`,
        duration: Date.now() - alertsStart,
      });

      // Complete
      setCurrentRun(prev => prev ? {
        ...prev,
        status: 'success',
        finishedAt: new Date(),
        result: {
          caseMetadata: scrapeResult.caseMetadata,
          actuacionesCount: normalized.length,
          typesDetected: [...new Set(detectedTypes)],
        },
      } : prev);

      toast.success("Test completado exitosamente");

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Error desconocido';
      
      setCurrentRun(prev => prev ? {
        ...prev,
        status: 'error',
        finishedAt: new Date(),
        error: errorMsg,
      } : prev);

      toast.error(`Test fallido: ${errorMsg}`);
    } finally {
      setIsRunning(false);
    }
  };

  // Copy JSON to clipboard
  const copyJson = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("JSON copiado");
  };

  // Clear test history
  const clearHistory = () => {
    setTestRuns([]);
    setCurrentRun(null);
    toast.success("Historial limpiado");
  };

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
            Diagnóstico y pruebas de consultas externas CGP/CPNU
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkServices}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Verificar Servicios
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetchRuns()}>
            <Database className="h-4 w-4 mr-1" />
            Actualizar Logs
          </Button>
        </div>
      </div>

      {/* Service Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map((service) => (
          <Card key={service.name} className={
            service.status === 'online' ? 'border-green-500/30' :
            service.status === 'offline' ? 'border-destructive/30' :
            'border-muted'
          }>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{service.name}</span>
                </div>
                {service.status === 'checking' ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : service.status === 'online' ? (
                  <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Online
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Offline
                  </Badge>
                )}
              </div>
              {service.latency && (
                <p className="text-xs text-muted-foreground mt-2">
                  Latencia: {service.latency}ms
                </p>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Adapter Info */}
        <Card className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Adapter Activo</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {adapterRegistry.getDefault().name}
            </p>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              {adapterRegistry.getDefault().id}
            </p>
          </CardContent>
        </Card>

        {/* Error Count */}
        <Card className={Object.keys(errorSummary).length > 0 ? 'border-destructive/30' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-medium text-sm">Errores Recientes</span>
            </div>
            {Object.keys(errorSummary).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {Object.entries(errorSummary).slice(0, 4).map(([code, count]) => (
                  <Badge key={code} variant="destructive" className="text-xs">
                    {code}: {count}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-green-600">Sin errores</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs defaultValue="tester" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="tester">
            <Play className="h-4 w-4 mr-1" />
            Tester
          </TabsTrigger>
          <TabsTrigger value="flow">
            <ArrowRight className="h-4 w-4 mr-1" />
            Flow
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Terminal className="h-4 w-4 mr-1" />
            Logs ({recentRuns?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="adapters">
            <Globe className="h-4 w-4 mr-1" />
            Adapters
          </TabsTrigger>
        </TabsList>

        {/* Tester Tab */}
        <TabsContent value="tester" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Debug Test
              </CardTitle>
              <CardDescription>
                Ejecutar una consulta de prueba para diagnosticar el flujo completo
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <Label>Radicado (23 dígitos)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      value={testRadicado}
                      onChange={(e) => setTestRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
                      placeholder="05001400301520240193000"
                      className="font-mono"
                      maxLength={23}
                    />
                    <span className="text-sm text-muted-foreground self-center whitespace-nowrap">
                      {testRadicado.replace(/\D/g, '').length}/23
                    </span>
                  </div>
                </div>
                <div>
                  <Label>Adapter</Label>
                  <Select value={selectedAdapter} onValueChange={setSelectedAdapter}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {adapters.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={runDebugTest} disabled={isRunning || testRadicado.replace(/\D/g, '').length !== 23}>
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Ejecutando...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Ejecutar Test
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={clearHistory} disabled={testRuns.length === 0}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Limpiar
                </Button>
              </div>

              {/* Current Run Progress */}
              {currentRun && (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Progreso del Test</h3>
                    <Badge variant={
                      currentRun.status === 'success' ? 'secondary' :
                      currentRun.status === 'error' ? 'destructive' : 'default'
                    } className={currentRun.status === 'success' ? 'bg-green-500/10 text-green-600' : ''}>
                      {currentRun.status === 'running' ? 'En progreso' :
                       currentRun.status === 'success' ? 'Completado' : 'Error'}
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {currentRun.steps.map((step, idx) => {
                      const stageInfo = FLOW_STAGES.find(s => s.id === step.name);
                      return (
                        <div key={step.name} className={`p-3 rounded-lg border ${
                          step.status === 'success' ? 'bg-green-500/5 border-green-500/20' :
                          step.status === 'error' ? 'bg-destructive/5 border-destructive/20' :
                          step.status === 'running' ? 'bg-primary/5 border-primary/20' :
                          'bg-muted/50 border-border'
                        }`}>
                          <div className="flex items-center gap-3">
                            <div className="flex-shrink-0">
                              {step.status === 'success' ? (
                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                              ) : step.status === 'error' ? (
                                <XCircle className="h-5 w-5 text-destructive" />
                              ) : step.status === 'running' ? (
                                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                              ) : (
                                <Clock className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono text-xs">
                                  {idx + 1}. {stageInfo?.name || step.name}
                                </Badge>
                                {step.duration && (
                                  <span className="text-xs text-muted-foreground">
                                    {step.duration}ms
                                  </span>
                                )}
                                {step.errorCode && (
                                  <Badge variant="destructive" className="text-xs">
                                    {step.errorCode}
                                  </Badge>
                                )}
                              </div>
                              {step.message && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {step.message}
                                </p>
                              )}
                            </div>
                            {step.data && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyJson(step.data)}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {currentRun.result && (
                    <div className="mt-4">
                      <h4 className="font-medium mb-2">Resultado</h4>
                      <ScrollArea className="h-48 rounded border p-3 bg-muted/30">
                        <pre className="text-xs font-mono">
                          {JSON.stringify(currentRun.result, null, 2)}
                        </pre>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Test History */}
          {testRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Historial de Tests</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hora</TableHead>
                        <TableHead>Radicado</TableHead>
                        <TableHead>Adapter</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Duración</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="text-xs">
                            {run.startedAt.toLocaleTimeString('es-CO')}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {run.radicado.slice(0, 10)}...
                          </TableCell>
                          <TableCell className="text-xs">{run.adapter}</TableCell>
                          <TableCell>
                            <Badge variant={
                              run.status === 'success' ? 'secondary' :
                              run.status === 'error' ? 'destructive' : 'default'
                            } className={run.status === 'success' ? 'bg-green-500/10 text-green-600' : ''}>
                              {run.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {run.finishedAt
                              ? `${run.finishedAt.getTime() - run.startedAt.getTime()}ms`
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Flow Tab */}
        <TabsContent value="flow">
          <Card>
            <CardHeader>
              <CardTitle>Flujo de Consulta Externa</CardTitle>
              <CardDescription>
                Diagrama del proceso de consulta desde la validación hasta las alertas
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {FLOW_STAGES.map((stage, idx) => (
                  <div key={stage.id} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                        {idx + 1}
                      </div>
                      {idx < FLOW_STAGES.length - 1 && (
                        <div className="w-px h-12 bg-border" />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <h3 className="font-medium">{stage.name}</h3>
                      <p className="text-sm text-muted-foreground">{stage.description}</p>
                      
                      {/* Stage-specific details */}
                      {stage.id === 'lookup' && (
                        <div className="mt-2 p-2 bg-muted/50 rounded text-xs font-mono">
                          <p>Endpoint: {API_BASE_URL}/buscar?numero_radicacion=XXXX</p>
                          <p>Método: GET → POST (polling)</p>
                          <p>Timeout: 30s (lookup) + 2min (polling)</p>
                        </div>
                      )}
                      {stage.id === 'scrape' && (
                        <div className="mt-2 p-2 bg-muted/50 rounded text-xs">
                          <p>Extrae: proceso, sujetos_procesales, actuaciones, ultima_actuacion</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Error Codes Reference */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Códigos de Error</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Acción Recomendada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell><Badge variant="outline">INVALID_FORMAT</Badge></TableCell>
                    <TableCell>Radicado no tiene 23 dígitos</TableCell>
                    <TableCell>Verificar formato del radicado</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">TIMEOUT</Badge></TableCell>
                    <TableCell>Tiempo de espera agotado</TableCell>
                    <TableCell>Reintentar o verificar estado del servicio</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">RATE_LIMITED</Badge></TableCell>
                    <TableCell>Límite de consultas alcanzado (429)</TableCell>
                    <TableCell>Esperar antes de reintentar</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">HTTP_404</Badge></TableCell>
                    <TableCell>Proceso no encontrado</TableCell>
                    <TableCell>Verificar radicado o registrar manualmente</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">HTTP_500</Badge></TableCell>
                    <TableCell>Error interno del servidor</TableCell>
                    <TableCell>Reintentar más tarde</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">NETWORK_ERROR</Badge></TableCell>
                    <TableCell>Error de conexión</TableCell>
                    <TableCell>Verificar conectividad</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell><Badge variant="outline">NO_DATA</Badge></TableCell>
                    <TableCell>Respuesta sin datos del proceso</TableCell>
                    <TableCell>El proceso puede no existir</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Logs de Crawler (DB)</span>
                <Button variant="outline" size="sm" onClick={() => refetchRuns()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Radicado</TableHead>
                      <TableHead>Adapter</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>HTTP</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Duración</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentRuns?.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="text-xs">
                          {new Date(run.started_at).toLocaleString('es-CO', { 
                            month: 'short', 
                            day: 'numeric', 
                            hour: '2-digit', 
                            minute: '2-digit' 
                          })}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {run.radicado.slice(0, 12)}...
                        </TableCell>
                        <TableCell className="text-xs">{run.adapter}</TableCell>
                        <TableCell>
                          <Badge variant={
                            run.status === 'SUCCESS' ? 'secondary' :
                            run.status === 'ERROR' ? 'destructive' : 'default'
                          } className={run.status === 'SUCCESS' ? 'bg-green-500/10 text-green-600' : ''}>
                            {run.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {run.http_status && (
                            <Badge variant={run.http_status >= 400 ? 'destructive' : 'outline'}>
                              {run.http_status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {run.error_code && (
                            <span className="text-xs text-destructive font-mono">
                              {run.error_code}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {run.duration_ms ? `${run.duration_ms}ms` : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adapters Tab */}
        <TabsContent value="adapters">
          <div className="grid gap-4">
            {adapters.map((adapter) => (
              <Card key={adapter.id} className={adapter.id === selectedAdapter ? 'border-primary' : ''}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{adapter.name}</CardTitle>
                    <div className="flex gap-2">
                      {adapter.active ? (
                        <Badge className="bg-green-500/10 text-green-600">Activo</Badge>
                      ) : (
                        <Badge variant="secondary">Inactivo</Badge>
                      )}
                      {adapter.id === adapterRegistry.getDefault().id && (
                        <Badge variant="default">Por defecto</Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription>{adapter.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">ID:</span>
                      <code className="ml-2 font-mono text-xs bg-muted px-1 py-0.5 rounded">
                        {adapter.id}
                      </code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Métodos:</span>
                      <span className="ml-2">lookup, scrapeCase, normalizeActuaciones</span>
                    </div>
                  </div>
                  
                  {adapter.id === 'external-rama-judicial-api' && (
                    <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                      <h4 className="font-medium text-sm mb-2">Configuración</h4>
                      <div className="space-y-1 text-xs font-mono">
                        <p>Base URL: {API_BASE_URL}</p>
                        <p>Timeout: 30000ms</p>
                        <p>Endpoints: /buscar, /resultado/:jobId</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
