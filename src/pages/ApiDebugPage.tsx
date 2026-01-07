import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { API_BASE_URL, API_ENDPOINTS, API_TIMEOUTS, ERROR_CODES, type DebugTrace } from "@/config/api";
import { adapterRegistry } from "@/lib/scraping/adapter-registry";
import { 
  normalizeRadicado, 
  validateCompleteness, 
  validateGoldenTest, 
  GOLDEN_TEST_DATA,
  type GoldenTestResult 
} from "@/lib/radicado-utils";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  Network,
  Timer,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Zap,
  FlaskConical,
  Award,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

// ============== Types ==============

interface TestStep {
  name: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  message?: string;
  duration?: number;
  data?: unknown;
  errorCode?: string;
  httpStatus?: number;
  traces?: DebugTrace[];
}

interface PollingProgress {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  status: string;
  startTime: number;
  lastPollTime?: number;
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
  traces: DebugTrace[];
  pollingProgress?: PollingProgress;
  rawApiResponse?: unknown;
}

interface ServiceStatus {
  name: string;
  url: string;
  status: 'checking' | 'online' | 'offline' | 'degraded' | 'cold-start';
  latency?: number;
  lastChecked?: Date;
  error?: string;
  httpStatus?: number;
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
  debug_excerpt?: string | null;
  request_meta?: unknown;
  response_meta?: unknown;
}

// ============== Constants ==============

const SERVICES: Omit<ServiceStatus, 'status' | 'latency' | 'lastChecked'>[] = [
  { name: 'Rama Judicial API (Render)', url: API_BASE_URL },
  { name: 'Supabase API', url: import.meta.env.VITE_SUPABASE_URL || '' },
];

const FLOW_STAGES = [
  { id: 'validate', name: 'Validar Formato', description: 'Verificar que el radicado tenga 23 dígitos', icon: CheckCircle2 },
  { id: 'init_request', name: 'Solicitud Inicial', description: 'Enviar petición al endpoint /buscar', icon: Network },
  { id: 'polling', name: 'Polling', description: 'Esperar resultado con job ID', icon: Timer },
  { id: 'parse_response', name: 'Parsear Respuesta', description: 'Interpretar datos del proceso y actuaciones', icon: FileJson },
  { id: 'normalize', name: 'Normalizar', description: 'Estandarizar fechas, textos y tipos', icon: Zap },
  { id: 'store', name: 'Almacenar', description: 'Guardar en base de datos (simulado)', icon: Database },
];

const POLLING_STATUS_MAP: Record<string, { label: string; color: string }> = {
  'pending': { label: 'Pendiente', color: 'bg-yellow-500' },
  'processing': { label: 'Procesando', color: 'bg-blue-500' },
  'completed': { label: 'Completado', color: 'bg-green-500' },
  'failed': { label: 'Fallido', color: 'bg-red-500' },
};

// ============== Golden Test Panel Component ==============

function GoldenTestPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [testResult, setTestResult] = useState<GoldenTestResult | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const runGoldenTest = async () => {
    setIsRunning(true);
    setTestResult(null);
    setRawResponse(null);
    setError(null);
    const startTime = Date.now();

    try {
      const radicado = GOLDEN_TEST_DATA.radicado;
      
      // Step 1: Initial request
      const searchUrl = `${API_BASE_URL}${API_ENDPOINTS.BUSCAR}?numero_radicacion=${radicado}`;
      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const initData = await response.json();
      
      // Step 2: Poll if jobId
      let finalData = initData;
      if (initData.jobId) {
        let attempts = 0;
        while (attempts < 60) {
          attempts++;
          await new Promise(r => setTimeout(r, 2000));
          
          const pollResponse = await fetch(`${API_BASE_URL}${API_ENDPOINTS.RESULTADO}/${initData.jobId}`);
          const pollData = await pollResponse.json();
          
          if (pollData.status === 'completed' || pollData.status === 'failed') {
            finalData = pollData;
            break;
          }
        }
      }

      setRawResponse(finalData);
      setDuration(Date.now() - startTime);
      
      // Run golden test validation
      const result = validateGoldenTest(finalData);
      setTestResult(result);
      
      if (result.passed) {
        toast.success("¡Golden Test PASÓ!");
      } else {
        toast.error(`Golden Test FALLÓ: ${result.checks.filter(c => !c.passed).length} verificaciones fallidas`);
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
      setDuration(Date.now() - startTime);
      toast.error("Error ejecutando Golden Test");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-500" />
          Golden Test: Radicado {GOLDEN_TEST_DATA.radicadoFormatted}
        </CardTitle>
        <CardDescription>
          Test obligatorio que valida la extracción completa del proceso. 
          El sistema debe encontrar: despacho, sujetos, actuaciones y estados electrónicos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium mb-2">Datos Esperados:</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Despacho:</span>
              <p className="font-mono text-xs">{GOLDEN_TEST_DATA.expected.despacho}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Tipo/Clase:</span>
              <p className="font-mono text-xs">{GOLDEN_TEST_DATA.expected.tipo} / {GOLDEN_TEST_DATA.expected.clase}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Demandantes:</span>
              <ul className="font-mono text-xs">
                {GOLDEN_TEST_DATA.expected.demandantes.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
            <div>
              <span className="text-muted-foreground">Demandados:</span>
              <ul className="font-mono text-xs">
                {GOLDEN_TEST_DATA.expected.demandados.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          </div>
        </div>

        <Button onClick={runGoldenTest} disabled={isRunning} className="w-full">
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Ejecutando Golden Test...
            </>
          ) : (
            <>
              <FlaskConical className="h-4 w-4 mr-2" />
              Ejecutar Golden Test
            </>
          )}
        </Button>

        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">Error: {error}</span>
            </div>
          </div>
        )}

        {testResult && (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg border ${testResult.passed ? 'bg-green-500/10 border-green-500/30' : 'bg-destructive/10 border-destructive/30'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {testResult.passed ? (
                    <CheckCircle2 className="h-6 w-6 text-green-500" />
                  ) : (
                    <XCircle className="h-6 w-6 text-destructive" />
                  )}
                  <span className="font-bold text-lg">
                    {testResult.passed ? 'TEST PASÓ' : 'TEST FALLÓ'}
                  </span>
                </div>
                <Badge variant={testResult.passed ? 'secondary' : 'destructive'}>
                  Score: {testResult.score}/{testResult.maxScore}
                </Badge>
              </div>
              {duration && <p className="text-sm text-muted-foreground mt-2">Duración: {duration}ms</p>}
            </div>

            <div className="space-y-2">
              <h4 className="font-medium">Verificaciones:</h4>
              {testResult.checks.map((check, idx) => (
                <div key={idx} className={`p-3 rounded border ${check.passed ? 'bg-green-500/5 border-green-500/20' : 'bg-destructive/5 border-destructive/20'}`}>
                  <div className="flex items-center gap-2">
                    {check.passed ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                    <span className="font-medium">{check.name}</span>
                    {check.critical && <Badge variant="outline" className="text-xs">Crítico</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div><span className="text-muted-foreground">Esperado:</span> {check.expected}</div>
                    <div><span className="text-muted-foreground">Actual:</span> {check.actual}</div>
                  </div>
                </div>
              ))}
            </div>

            {rawResponse && (
              <Accordion type="single" collapsible>
                <AccordionItem value="raw">
                  <AccordionTrigger>Ver Respuesta Raw</AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="h-64 rounded border p-3 bg-muted/30">
                      <pre className="text-xs font-mono">{JSON.stringify(rawResponse, null, 2)}</pre>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============== Main Component ==============

export default function ApiDebugPage() {
  const [testRadicado, setTestRadicado] = useState("05001400301520240193000");
  const [selectedAdapter, setSelectedAdapter] = useState("external-rama-judicial-api");
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<TestRun | null>(null);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState("tester");
  const [showRawResponse, setShowRawResponse] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Add trace to current run
  const addTrace = useCallback((trace: Omit<DebugTrace, 'id' | 'timestamp'>) => {
    const fullTrace: DebugTrace = {
      ...trace,
      id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, fullTrace] } : prev);
    return fullTrace;
  }, []);

  // Check service status with detailed response
  const checkServices = useCallback(async () => {
    const updatedServices: ServiceStatus[] = [];

    for (const service of SERVICES) {
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        // Try actual GET request for better diagnostics
        const response = await fetch(service.url, {
          method: 'GET',
          signal: controller.signal,
        }).catch(() => null);
        
        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;
        
        if (response) {
          // Check for cold start (Render free tier)
          const isColdStart = latency > 5000;
          updatedServices.push({
            ...service,
            status: isColdStart ? 'cold-start' : 'online',
            latency,
            lastChecked: new Date(),
            httpStatus: response.status,
          });
        } else {
          // Fallback to no-cors mode
          await fetch(service.url, { method: 'HEAD', mode: 'no-cors' });
          updatedServices.push({
            ...service,
            status: 'online',
            latency: Date.now() - startTime,
            lastChecked: new Date(),
          });
        }
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

  // Run enhanced debug test with full HTTP tracing
  const runDebugTest = async () => {
    if (!testRadicado.trim() || isRunning) return;

    setIsRunning(true);
    abortControllerRef.current = new AbortController();

    const runId = `test-${Date.now()}`;
    const run: TestRun = {
      id: runId,
      radicado: testRadicado.replace(/\D/g, ''),
      adapter: selectedAdapter,
      startedAt: new Date(),
      status: 'running',
      steps: FLOW_STAGES.map(s => ({ name: s.id, status: 'pending' as const })),
      traces: [],
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

    const updatePolling = (progress: PollingProgress) => {
      setCurrentRun(prev => prev ? { ...prev, pollingProgress: progress } : prev);
    };

    try {
      const cleanRadicado = testRadicado.replace(/\D/g, '');
      
      // ======== Step 1: Validate Format ========
      const validateStart = Date.now();
      updateStep('validate', { status: 'running' });
      
      if (cleanRadicado.length !== 23) {
        const trace: DebugTrace = {
          id: `trace-${Date.now()}`,
          timestamp: new Date().toISOString(),
          stage: 'validate',
          type: 'error',
          error: `Formato inválido: ${cleanRadicado.length}/23 dígitos`,
        };
        setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, trace] } : prev);
        
        updateStep('validate', {
          status: 'error',
          message: `Formato inválido: ${cleanRadicado.length}/23 dígitos`,
          errorCode: ERROR_CODES.INVALID_FORMAT,
          duration: Date.now() - validateStart,
        });
        throw new Error(ERROR_CODES.INVALID_FORMAT);
      }
      
      updateStep('validate', {
        status: 'success',
        message: `Radicado válido: ${cleanRadicado}`,
        duration: Date.now() - validateStart,
      });

      // ======== Step 2: Initial Request ========
      const initStart = Date.now();
      updateStep('init_request', { status: 'running' });
      
      const searchUrl = `${API_BASE_URL}${API_ENDPOINTS.BUSCAR}?numero_radicacion=${cleanRadicado}`;
      
      // Log request trace
      const requestTrace: DebugTrace = {
        id: `trace-${Date.now()}`,
        timestamp: new Date().toISOString(),
        stage: 'init_request',
        type: 'request',
        url: searchUrl,
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      };
      setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, requestTrace] } : prev);
      
      let initResponse: Response;
      try {
        initResponse = await fetch(searchUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          signal: abortControllerRef.current?.signal,
        });
      } catch (fetchError) {
        const errorTrace: DebugTrace = {
          id: `trace-${Date.now()}`,
          timestamp: new Date().toISOString(),
          stage: 'init_request',
          type: 'error',
          url: searchUrl,
          error: fetchError instanceof Error ? fetchError.message : 'Network error',
        };
        setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, errorTrace] } : prev);
        
        updateStep('init_request', {
          status: 'error',
          message: `Error de red: ${fetchError instanceof Error ? fetchError.message : 'Unknown'}`,
          errorCode: ERROR_CODES.NETWORK_ERROR,
          duration: Date.now() - initStart,
        });
        throw new Error(ERROR_CODES.NETWORK_ERROR);
      }

      const initDuration = Date.now() - initStart;
      let initData: Record<string, unknown>;
      
      try {
        initData = await initResponse.json();
      } catch {
        updateStep('init_request', {
          status: 'error',
          message: `Error parseando respuesta (HTTP ${initResponse.status})`,
          errorCode: ERROR_CODES.PARSE_ERROR,
          httpStatus: initResponse.status,
          duration: initDuration,
        });
        throw new Error(ERROR_CODES.PARSE_ERROR);
      }

      // Log response trace
      const responseTrace: DebugTrace = {
        id: `trace-${Date.now()}`,
        timestamp: new Date().toISOString(),
        stage: 'init_request',
        type: 'response',
        url: searchUrl,
        status: initResponse.status,
        duration: initDuration,
        body: initData,
      };
      setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, responseTrace] } : prev);

      // Check HTTP status
      if (!initResponse.ok) {
        const errorCode = initResponse.status === 429 ? ERROR_CODES.RATE_LIMITED : 
                         initResponse.status === 404 ? ERROR_CODES.NOT_FOUND :
                         `HTTP_${initResponse.status}`;
        updateStep('init_request', {
          status: 'error',
          message: `HTTP ${initResponse.status}: ${initData.error || initResponse.statusText}`,
          errorCode,
          httpStatus: initResponse.status,
          duration: initDuration,
          data: initData,
        });
        throw new Error(errorCode);
      }

      updateStep('init_request', {
        status: 'success',
        message: initData.jobId 
          ? `Job iniciado: ${initData.jobId}` 
          : `Respuesta directa (${Object.keys(initData).length} campos)`,
        httpStatus: initResponse.status,
        duration: initDuration,
        data: { jobId: initData.jobId, hasProcess: !!initData.proceso, keys: Object.keys(initData) },
      });

      // ======== Step 3: Polling (if jobId) ========
      let finalData = initData;
      
      if (initData.jobId) {
        const pollingStart = Date.now();
        updateStep('polling', { status: 'running' });
        
        const jobId = initData.jobId as string;
        let attempts = 0;
        let lastStatus = 'pending';
        
        while (attempts < API_TIMEOUTS.MAX_POLLING_ATTEMPTS) {
          attempts++;
          
          updatePolling({
            jobId,
            attempt: attempts,
            maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
            status: lastStatus,
            startTime: pollingStart,
            lastPollTime: Date.now(),
          });

          // Wait between polls
          await new Promise(r => setTimeout(r, API_TIMEOUTS.POLLING_INTERVAL_MS));
          
          const pollUrl = `${API_BASE_URL}${API_ENDPOINTS.RESULTADO}/${jobId}`;
          
          // Log poll request
          const pollTrace: DebugTrace = {
            id: `trace-${Date.now()}`,
            timestamp: new Date().toISOString(),
            stage: 'polling',
            type: 'poll',
            url: pollUrl,
            method: 'GET',
            body: { attempt: attempts, elapsed: Date.now() - pollingStart },
          };
          setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, pollTrace] } : prev);
          
          try {
            const pollResponse = await fetch(pollUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
              signal: abortControllerRef.current?.signal,
            });
            
            const pollData = await pollResponse.json() as Record<string, unknown>;
            lastStatus = (pollData.status as string) || 'unknown';
            
            // Log poll response
            const pollRespTrace: DebugTrace = {
              id: `trace-${Date.now()}`,
              timestamp: new Date().toISOString(),
              stage: 'polling',
              type: 'response',
              url: pollUrl,
              status: pollResponse.status,
              body: { status: pollData.status, estado: pollData.estado, hasProcess: !!pollData.proceso },
            };
            setCurrentRun(prev => prev ? { ...prev, traces: [...prev.traces, pollRespTrace] } : prev);
            
            updatePolling({
              jobId,
              attempt: attempts,
              maxAttempts: API_TIMEOUTS.MAX_POLLING_ATTEMPTS,
              status: lastStatus,
              startTime: pollingStart,
              lastPollTime: Date.now(),
            });
            
            if (pollData.status === 'completed') {
              finalData = pollData;
              updateStep('polling', {
                status: 'success',
                message: `Completado en ${attempts} intentos (${Date.now() - pollingStart}ms)`,
                duration: Date.now() - pollingStart,
                data: { attempts, finalStatus: pollData.status, estado: pollData.estado },
              });
              break;
            }
            
            if (pollData.status === 'failed') {
              updateStep('polling', {
                status: 'error',
                message: `Job falló: ${pollData.error || 'Unknown error'}`,
                errorCode: ERROR_CODES.API_ERROR,
                duration: Date.now() - pollingStart,
                data: pollData,
              });
              throw new Error(ERROR_CODES.API_ERROR);
            }
          } catch (pollError) {
            if (pollError instanceof Error && pollError.message === ERROR_CODES.API_ERROR) {
              throw pollError;
            }
            // Network error during polling - continue
            console.warn(`Polling attempt ${attempts} failed:`, pollError);
          }
        }
        
        // Check for timeout
        if (attempts >= API_TIMEOUTS.MAX_POLLING_ATTEMPTS && finalData.status !== 'completed') {
          updateStep('polling', {
            status: 'error',
            message: `Timeout después de ${attempts} intentos (${Date.now() - pollingStart}ms)`,
            errorCode: ERROR_CODES.TIMEOUT,
            duration: Date.now() - pollingStart,
          });
          throw new Error(ERROR_CODES.TIMEOUT);
        }
      } else {
        // No polling needed
        updateStep('polling', {
          status: 'skipped',
          message: 'Respuesta directa sin polling',
          duration: 0,
        });
      }

      // Store raw API response
      setCurrentRun(prev => prev ? { ...prev, rawApiResponse: finalData } : prev);

      // ======== Step 4: Parse Response ========
      const parseStart = Date.now();
      updateStep('parse_response', { status: 'running' });
      
      // Check for NOT_FOUND
      if (finalData.estado === 'NO_ENCONTRADO') {
        updateStep('parse_response', {
          status: 'error',
          message: 'Proceso no encontrado en el sistema',
          errorCode: ERROR_CODES.NOT_FOUND,
          duration: Date.now() - parseStart,
          data: finalData,
        });
        throw new Error(ERROR_CODES.NOT_FOUND);
      }
      
      // Check for process data
      if (!finalData.proceso) {
        updateStep('parse_response', {
          status: 'error',
          message: 'Respuesta sin datos de proceso',
          errorCode: ERROR_CODES.NO_PROCESS_DATA,
          duration: Date.now() - parseStart,
          data: { keys: Object.keys(finalData), sample: JSON.stringify(finalData).slice(0, 200) },
        });
        throw new Error(ERROR_CODES.NO_PROCESS_DATA);
      }

      const proceso = finalData.proceso as Record<string, string>;
      const actuaciones = (finalData.actuaciones || []) as Array<Record<string, string>>;
      const sujetos = (finalData.sujetos_procesales || []) as Array<{ tipo: string; nombre: string }>;
      
      updateStep('parse_response', {
        status: 'success',
        message: `Proceso: ${proceso['Despacho'] || 'N/A'} | Actuaciones: ${actuaciones.length} | Sujetos: ${sujetos.length}`,
        duration: Date.now() - parseStart,
        data: { 
          despacho: proceso['Despacho'],
          tipoProceso: proceso['Tipo de Proceso'],
          actuacionesCount: actuaciones.length,
          sujetosCount: sujetos.length,
          totalActuaciones: finalData.total_actuaciones,
        },
      });

      // ======== Step 5: Normalize ========
      const normalizeStart = Date.now();
      updateStep('normalize', { status: 'running' });
      
      // Simple normalization for debug
      const normalizedSample = actuaciones.slice(0, 5).map((act, idx) => ({
        index: idx,
        fecha: act['Fecha de Actuación'] || act['fecha_actuacion'] || 'N/A',
        actuacion: (act['Actuación'] || act['actuacion'] || '').slice(0, 100),
        anotacion: (act['Anotación'] || act['anotacion'] || '').slice(0, 50),
      }));
      
      updateStep('normalize', {
        status: 'success',
        message: `Normalizados ${actuaciones.length} registros`,
        duration: Date.now() - normalizeStart,
        data: { count: actuaciones.length, sample: normalizedSample },
      });

      // ======== Step 6: Store (simulated) ========
      const storeStart = Date.now();
      updateStep('store', { status: 'running' });
      await new Promise(r => setTimeout(r, 100));
      
      updateStep('store', {
        status: 'success',
        message: `Listo para almacenar ${actuaciones.length} actuaciones (simulado)`,
        duration: Date.now() - storeStart,
      });

      // Complete run
      setCurrentRun(prev => prev ? {
        ...prev,
        status: 'success',
        finishedAt: new Date(),
        result: {
          despacho: proceso['Despacho'],
          tipoProceso: proceso['Tipo de Proceso'],
          demandante: proceso['Demandante'],
          demandado: proceso['Demandado'],
          actuacionesCount: actuaciones.length,
          sujetosCount: sujetos.length,
          totalActuaciones: finalData.total_actuaciones,
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
      abortControllerRef.current = null;
    }
  };

  // Cancel running test
  const cancelTest = () => {
    abortControllerRef.current?.abort();
    setIsRunning(false);
    toast.info("Test cancelado");
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="tester">
            <Play className="h-4 w-4 mr-1" />
            Tester
          </TabsTrigger>
          <TabsTrigger value="golden">
            <FlaskConical className="h-4 w-4 mr-1" />
            Golden Test
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

        {/* Golden Test Tab */}
        <TabsContent value="golden" className="space-y-4">
          <GoldenTestPanel />
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
