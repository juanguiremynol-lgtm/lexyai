/**
 * Unified Debug Console
 * 
 * Comprehensive debugging panel for testing all judicial API providers
 * based on workflow type. Tests the full pipeline: API → Edge Functions → Database → UI
 */

import { RouteDiscoveryPanel } from './RouteDiscoveryPanel';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Loader2, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Play,
  ChevronDown,
  Globe,
  Database,
  FileText,
  Server,
  Clock,
  Hash,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906';

interface DebugResult {
  step: string;
  status: 'success' | 'error' | 'warning' | 'pending' | 'running';
  message: string;
  data?: unknown;
  duration?: number;
}

// Provider configuration per workflow
const WORKFLOW_PROVIDERS: Record<WorkflowType, { 
  primary: string; 
  secondary?: string; 
  publicaciones: boolean;
  description: string;
}> = {
  CGP: { 
    primary: 'cpnu', 
    secondary: undefined,  // NO SAMAI fallback for CGP
    publicaciones: true,
    description: 'Civil/Familia - CPNU (sin fallback SAMAI)'
  },
  LABORAL: { 
    primary: 'cpnu', 
    secondary: undefined,  // NO SAMAI fallback for LABORAL
    publicaciones: true,
    description: 'Laboral - CPNU (sin fallback SAMAI)'
  },
  CPACA: { 
    primary: 'samai', 
    publicaciones: true,
    description: 'Administrativo - SAMAI primario'
  },
  TUTELA: { 
    primary: 'cpnu', 
    secondary: 'tutelas', 
    publicaciones: false,
    description: 'Tutela - CPNU + Tutelas API'
  },
  PENAL_906: { 
    primary: 'cpnu', 
    secondary: 'samai',
    publicaciones: true,
    description: 'Penal 906 - CPNU + Publicaciones'
  },
};

export function UnifiedDebugConsole() {
  const [radicado, setRadicado] = useState('');
  const [workflowType, setWorkflowType] = useState<WorkflowType>('CGP');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<DebugResult[]>([]);
  const [rawResponses, setRawResponses] = useState<Record<string, unknown>>({});
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const addResult = (result: DebugResult) => {
    setResults(prev => [...prev, result]);
  };

  const updateResult = (step: string, update: Partial<DebugResult>) => {
    setResults(prev => prev.map(r => r.step === step ? { ...r, ...update } : r));
  };

  const toggleExpanded = (step: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) {
        next.delete(step);
      } else {
        next.add(step);
      }
      return next;
    });
  };

  const runFullDiagnostic = async () => {
    if (!radicado || radicado.length !== 23) {
      alert('Ingrese un radicado válido de 23 dígitos');
      return;
    }

    setIsRunning(true);
    setResults([]);
    setRawResponses({});
    setExpandedSteps(new Set());

    const config = WORKFLOW_PROVIDERS[workflowType];

    try {
      // ========================================
      // STEP 1: Test Primary Provider Health
      // ========================================
      addResult({ 
        step: `${config.primary.toUpperCase()}_HEALTH`, 
        status: 'running', 
        message: `Verificando conectividad ${config.primary}...` 
      });
      const healthStart = Date.now();

      const { data: healthData, error: healthError } = await supabase.functions.invoke('debug-external-provider', {
        body: { provider: config.primary, action: 'health' }
      });

      updateResult(`${config.primary.toUpperCase()}_HEALTH`, {
        status: healthError ? 'error' : 'success',
        message: healthError ? `❌ ${healthError.message}` : `✅ /health OK (${healthData?.status || 200})`,
        data: healthData,
        duration: Date.now() - healthStart
      });

      // ========================================
      // STEP 2: Test Primary Provider Auth
      // ========================================
      addResult({ 
        step: `${config.primary.toUpperCase()}_AUTH`, 
        status: 'running', 
        message: `Verificando autenticación ${config.primary}...` 
      });
      const authStart = Date.now();

      const { data: authData, error: authError } = await supabase.functions.invoke('debug-external-provider', {
        body: { provider: config.primary, action: 'snapshot', identifier: radicado }
      });

      setRawResponses(prev => ({ ...prev, [`${config.primary}_snapshot`]: authData }));

      const authOk = !authError && (authData?.status === 200 || authData?.status === 404);
      updateResult(`${config.primary.toUpperCase()}_AUTH`, {
        status: authOk ? 'success' : 'error',
        message: authOk 
          ? `✅ Auth OK (HTTP ${authData?.status})` 
          : `❌ Auth failed: ${authError?.message || authData?.message}`,
        data: authData,
        duration: Date.now() - authStart
      });

      // ========================================
      // STEP 3: Analyze Data Structure (if data found)
      // ========================================
      const actuaciones = authData?.raw?.actuaciones || authData?.raw?.proceso?.actuaciones || [];
      
      if (actuaciones.length > 0) {
        const sampleAct = actuaciones[0];
        const fields = Object.keys(sampleAct || {});

        addResult({
          step: 'DATA_STRUCTURE',
          status: 'success',
          message: `📊 ${actuaciones.length} actuaciones encontradas con ${fields.length} campos`,
          data: { fields, sample: sampleAct, count: actuaciones.length }
        });

        // Check for important CPNU/SAMAI fields
        const cpnuFields = ['fechaActuacion', 'actuacion', 'anotacion', 'nombreDespacho', 'documentos', 'idActuacion'];
        const samaiFields = ['fechaActuacion', 'actuacion', 'anotacion', 'fechaRegistro', 'estado', 'anexos', 'indice'];
        
        const foundCpnuFields = cpnuFields.filter(f => fields.includes(f));
        const foundSamaiFields = samaiFields.filter(f => fields.includes(f));

        const detectedProvider = foundSamaiFields.length > foundCpnuFields.length ? 'SAMAI' : 'CPNU';
        
        addResult({
          step: 'FIELD_ANALYSIS',
          status: 'success',
          message: `Formato detectado: ${detectedProvider} (${detectedProvider === 'CPNU' ? foundCpnuFields.length : foundSamaiFields.length} campos conocidos)`,
          data: { 
            cpnuFieldsFound: foundCpnuFields, 
            samaiFieldsFound: foundSamaiFields,
            allFields: fields 
          }
        });
      } else if (authData?.status === 404) {
        addResult({
          step: 'DATA_STRUCTURE',
          status: 'warning',
          message: '⚠️ Radicado no encontrado en caché - puede necesitar scraping',
          data: { status: 404, scraping_initiated: authData?.scraping_initiated }
        });
      }

      // ========================================
      // STEP 4: Test Publicaciones (if applicable)
      // ========================================
      if (config.publicaciones) {
        addResult({ 
          step: 'PUBLICACIONES_FETCH', 
          status: 'running', 
          message: 'Verificando publicaciones procesales...' 
        });
        const pubStart = Date.now();

        const { data: pubData, error: pubError } = await supabase.functions.invoke('debug-external-provider', {
          body: { provider: 'publicaciones', action: 'snapshot', identifier: radicado }
        });

        setRawResponses(prev => ({ ...prev, publicaciones: pubData }));

        const pubs = pubData?.raw?.publicaciones || [];
        updateResult('PUBLICACIONES_FETCH', {
          status: pubs.length > 0 ? 'success' : pubData?.status === 404 ? 'warning' : 'error',
          message: pubs.length > 0 
            ? `✅ ${pubs.length} publicaciones encontradas`
            : pubData?.status === 404 
              ? '⚠️ No hay publicaciones en caché'
              : `❌ Error: ${pubError?.message || pubData?.message}`,
          data: pubData,
          duration: Date.now() - pubStart
        });
      }

      // ========================================
      // STEP 5: Check Database for Work Item
      // ========================================
      addResult({ 
        step: 'DB_WORK_ITEM', 
        status: 'running', 
        message: 'Buscando work_item en base de datos...' 
      });

      const { data: workItems, error: wiError } = await supabase
        .from('work_items')
        .select('id, radicado, workflow_type, stage, scrape_status, last_crawled_at, total_actuaciones')
        .eq('radicado', radicado)
        .limit(1);

      const workItem = workItems?.[0];

      if (workItem) {
        updateResult('DB_WORK_ITEM', {
          status: 'success',
          message: `✅ Work item encontrado (${workItem.workflow_type}, stage: ${workItem.stage})`,
          data: workItem
        });

        // Check stored actuaciones
        const { data: storedActs, count: actCount } = await supabase
          .from('actuaciones')
          .select('id, raw_text, act_date, source, indice, anexos_count, estado', { count: 'exact' })
          .eq('work_item_id', workItem.id)
          .order('act_date', { ascending: false })
          .limit(5);

        addResult({
          step: 'DB_ACTUACIONES',
          status: (actCount || 0) > 0 ? 'success' : 'warning',
          message: `${actCount || 0} actuaciones almacenadas en DB`,
          data: { count: actCount, sample: storedActs }
        });

        // Check stored publicaciones
        const { data: storedPubs, count: pubCount } = await supabase
          .from('work_item_publicaciones')
          .select('id, title, published_at, source', { count: 'exact' })
          .eq('work_item_id', workItem.id)
          .order('published_at', { ascending: false })
          .limit(5);

        addResult({
          step: 'DB_PUBLICACIONES',
          status: (pubCount || 0) > 0 ? 'success' : 'warning',
          message: `${pubCount || 0} publicaciones almacenadas en DB`,
          data: { count: pubCount, sample: storedPubs }
        });

      } else {
        updateResult('DB_WORK_ITEM', {
          status: 'warning',
          message: '⚠️ No existe work_item con este radicado',
          data: null
        });
      }

      // ========================================
      // STEP 6: Summary
      // ========================================
      addResult({
        step: 'SUMMARY',
        status: 'success',
        message: '✅ Diagnóstico completado',
        data: {
          workflow: workflowType,
          radicado,
          primary_provider: config.primary,
          secondary_provider: config.secondary || 'none',
          publicaciones_enabled: config.publicaciones,
          total_steps: results.length + 1
        }
      });

    } catch (err) {
      addResult({
        step: 'UNEXPECTED_ERROR',
        status: 'error',
        message: `❌ Error inesperado: ${(err as Error).message}`,
        data: err
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: DebugResult['status']) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStepIcon = (step: string) => {
    if (step.includes('HEALTH')) return <Globe className="h-4 w-4" />;
    if (step.includes('AUTH')) return <Server className="h-4 w-4" />;
    if (step.includes('DB_')) return <Database className="h-4 w-4" />;
    if (step.includes('DATA_') || step.includes('FIELD_')) return <Hash className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Consola de Debug Unificada
        </CardTitle>
        <CardDescription>
          Prueba completa del pipeline: API Externa → Edge Functions → Base de Datos → UI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input Section */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1.5 block">Radicado (23 dígitos)</label>
            <Input
              placeholder="05001400302020250187800"
              value={radicado}
              onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
              className="font-mono"
            />
            {radicado.length > 0 && radicado.length !== 23 && (
              <p className="text-xs text-muted-foreground mt-1">{radicado.length}/23 dígitos</p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Tipo de Flujo</label>
            <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as WorkflowType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CGP">CGP (Civil)</SelectItem>
                <SelectItem value="LABORAL">LABORAL</SelectItem>
                <SelectItem value="CPACA">CPACA (Admin)</SelectItem>
                <SelectItem value="TUTELA">TUTELA</SelectItem>
                <SelectItem value="PENAL_906">PENAL 906</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button 
              onClick={runFullDiagnostic} 
              disabled={isRunning || radicado.length !== 23}
              className="w-full"
            >
              {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Ejecutar Diagnóstico
            </Button>
          </div>
        </div>

        {/* Provider Info */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            Primary: {WORKFLOW_PROVIDERS[workflowType].primary.toUpperCase()}
          </Badge>
          {WORKFLOW_PROVIDERS[workflowType].secondary && (
            <Badge variant="secondary">
              Fallback: {WORKFLOW_PROVIDERS[workflowType].secondary?.toUpperCase()}
            </Badge>
          )}
          {WORKFLOW_PROVIDERS[workflowType].publicaciones && (
            <Badge variant="default">+ Publicaciones</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-2">
            {WORKFLOW_PROVIDERS[workflowType].description}
          </span>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <Tabs defaultValue="steps" className="w-full">
            <TabsList>
              <TabsTrigger value="steps">Pasos ({results.length})</TabsTrigger>
              <TabsTrigger value="raw">Respuestas Raw</TabsTrigger>
            </TabsList>

            <TabsContent value="steps" className="space-y-2 mt-4">
              {results.map((result) => (
                <Collapsible 
                  key={result.step} 
                  open={expandedSteps.has(result.step)}
                  onOpenChange={() => toggleExpanded(result.step)}
                >
                  <div className={cn(
                    "rounded-lg border p-3",
                    result.status === 'error' && "border-destructive/50 bg-destructive/10",
                    result.status === 'warning' && "border-amber-500/50 bg-amber-500/10",
                    result.status === 'success' && "border-primary/50 bg-primary/10",
                    result.status === 'running' && "border-blue-500/50 bg-blue-500/10"
                  )}>
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between cursor-pointer">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(result.status)}
                          {getStepIcon(result.step)}
                          <span className="font-mono text-xs">{result.step}</span>
                          {result.duration && (
                            <Badge variant="outline" className="text-xs">
                              {result.duration}ms
                            </Badge>
                          )}
                        </div>
                        <ChevronDown className={cn(
                          "h-4 w-4 transition-transform",
                          expandedSteps.has(result.step) && "rotate-180"
                        )} />
                      </div>
                    </CollapsibleTrigger>
                    <p className="text-sm mt-2">{result.message}</p>
                    {result.data && (
                      <CollapsibleContent>
                        <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-48">
                          {JSON.stringify(result.data, null, 2)}
                        </pre>
                      </CollapsibleContent>
                    )}
                  </div>
                </Collapsible>
              ))}
            </TabsContent>

            <TabsContent value="raw" className="mt-4">
              <div className="space-y-4">
                {Object.entries(rawResponses).map(([key, data]) => (
                  <div key={key} className="rounded-lg border p-3">
                    <h4 className="font-mono text-sm font-medium mb-2">{key}</h4>
                    <pre className="p-2 bg-muted rounded text-xs overflow-auto max-h-96">
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Route Discovery Panel */}
        <RouteDiscoveryPanel />
      </CardContent>
    </Card>
  );
}
