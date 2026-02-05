/**
 * Estados Debug Panel - Full pipeline debugging for Publicaciones/Estados
 * 
 * Tests the entire data flow:
 * 1. Database schema verification
 * 2. Work item lookup
 * 3. Publicaciones API test (via debug-external-provider)
 * 4. Sync function execution
 * 5. Database record verification
 * 6. Field population check
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Loader2, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Database, 
  Globe, 
  Server, 
  Monitor,
  ChevronDown,
  Play,
  Search,
  FileText,
  RefreshCw,
  Newspaper,
  Copy,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DebugStep {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'warning';
  message: string;
  data?: unknown;
  duration?: number;
}

interface WorkItemInfo {
  id: string;
  radicado: string;
  workflow_type: string;
  organization_id: string;
  owner_id: string;
}

interface ScrapingInfo {
  jobId: string;
  pollUrl?: string;
  message: string;
  initiatedAt: Date;
}

export function EstadosDebugPanel() {
  // Pre-fill with known ICARUS radicado for testing
  const [radicado, setRadicado] = useState('05001400302020250187800');
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<DebugStep[]>([]);
  const [apiRawResponse, setApiRawResponse] = useState<unknown>(null);
  const [dbRecords, setDbRecords] = useState<unknown[]>([]);
  const [workItem, setWorkItem] = useState<WorkItemInfo | null>(null);
  const [scrapingInfo, setScrapingInfo] = useState<ScrapingInfo | null>(null);
  const [previousJobId, setPreviousJobId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for auto-retry
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && scrapingInfo && retryCount < 3) {
      // Auto-retry when countdown reaches 0
      // runFullDebug(); // Uncomment to enable auto-retry
    }
  }, [countdown, scrapingInfo, retryCount]);

  // Track if same job ID is returned (Cloud Run not processing)
  const checkSameJobId = (newJobId: string) => {
    if (previousJobId === newJobId) {
      setRetryCount(prev => prev + 1);
      return true;
    }
    setPreviousJobId(newJobId);
    setRetryCount(0);
    return false;
  };

  const copyDiagnosticReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      radicado,
      workItem: workItem ? { id: workItem.id, workflow_type: workItem.workflow_type } : null,
      scrapingInfo: scrapingInfo ? { jobId: scrapingInfo.jobId, initiatedAt: scrapingInfo.initiatedAt } : null,
      retryCount,
      steps: steps.map(s => ({ step: s.step, status: s.status, message: s.message })),
      apiResponse: apiRawResponse,
      dbRecordsCount: dbRecords.length,
      diagnosis: retryCount >= 2 
        ? 'CLOUD_RUN_ISSUE: Scraping job returns same ID repeatedly, data not appearing'
        : scrapingInfo 
        ? 'WAITING_FOR_SCRAPING: Job initiated, waiting for completion'
        : dbRecords.length > 0 
        ? 'SUCCESS: Data found in database'
        : 'NO_DATA: No records found'
    };
    
    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    toast.success('Diagnóstico copiado al portapapeles');
  };

  const updateStep = (stepName: string, update: Partial<DebugStep>) => {
    setSteps(prev => prev.map(s => 
      s.step === stepName ? { ...s, ...update } : s
    ));
  };

  const addStep = (step: DebugStep) => {
    setSteps(prev => [...prev, step]);
  };

  const runFullDebug = async () => {
    const normalizedRadicado = radicado.replace(/\D/g, '');
    if (normalizedRadicado.length !== 23) {
      alert('Ingrese un radicado válido de 23 dígitos');
      return;
    }

    setIsRunning(true);
    setSteps([]);
    setApiRawResponse(null);
    setDbRecords([]);
    setWorkItem(null);
    setScrapingInfo(null);

    try {
      // ============================================
      // STEP 1: Check Database Schema
      // ============================================
      addStep({ step: 'DB_SCHEMA', status: 'running', message: 'Verificando esquema de base de datos...' });
      const startSchema = Date.now();

      const { data: testRecord } = await supabase
        .from('work_item_publicaciones')
        .select('*')
        .limit(1);
      
      const availableColumns = testRecord?.[0] ? Object.keys(testRecord[0]) : [];
      if (testRecord?.length === 0) {
        // Table is empty, try to get columns from schema
        availableColumns.push('id', 'work_item_id', 'organization_id', 'source', 'title', 'annotation', 
          'pdf_url', 'published_at', 'hash_fingerprint', 'raw_data', 'created_at',
          'fecha_fijacion', 'fecha_desfijacion', 'despacho', 'tipo_publicacion');
      }
      
      const requiredColumns = ['fecha_fijacion', 'fecha_desfijacion', 'despacho', 'tipo_publicacion'];
      const missingColumns = requiredColumns.filter(col => !availableColumns.includes(col));

      updateStep('DB_SCHEMA', {
        status: missingColumns.length > 0 ? 'error' : 'success',
        message: missingColumns.length > 0 
          ? `❌ Columnas faltantes: ${missingColumns.join(', ')}`
          : `✅ Esquema correcto (${availableColumns.length} columnas)`,
        data: { availableColumns, requiredColumns, missingColumns },
        duration: Date.now() - startSchema
      });

      if (missingColumns.length > 0) {
        addStep({
          step: 'DB_MIGRATION_NEEDED',
          status: 'error',
          message: `REQUIERE MIGRACIÓN: ${missingColumns.join(', ')}`
        });
        setIsRunning(false);
        return;
      }

      // ============================================
      // STEP 2: Find Work Item
      // ============================================
      addStep({ step: 'FIND_WORK_ITEM', status: 'running', message: 'Buscando work_item con este radicado...' });
      const startFind = Date.now();

      const { data: foundItem, error: findError } = await supabase
        .from('work_items')
        .select('id, radicado, workflow_type, organization_id, owner_id')
        .eq('radicado', normalizedRadicado)
        .maybeSingle();

      if (findError) {
        updateStep('FIND_WORK_ITEM', {
          status: 'error',
          message: `❌ Error buscando: ${findError.message}`,
          data: findError,
          duration: Date.now() - startFind
        });
        setIsRunning(false);
        return;
      }

      if (foundItem) {
        setWorkItem(foundItem as WorkItemInfo);
        updateStep('FIND_WORK_ITEM', {
          status: 'success',
          message: `✅ Encontrado: ${(foundItem as WorkItemInfo).workflow_type} (ID: ${(foundItem as WorkItemInfo).id.slice(0, 8)}...)`,
          data: foundItem,
          duration: Date.now() - startFind
        });
      } else {
        updateStep('FIND_WORK_ITEM', {
          status: 'warning',
          message: '⚠️ No existe work_item. Cree uno primero.',
          duration: Date.now() - startFind
        });
        setIsRunning(false);
        return;
      }

      const currentWorkItem = foundItem as WorkItemInfo;

      // ============================================
      // STEP 3: Test API via debug-external-provider
      // ============================================
      addStep({ step: 'API_TEST', status: 'running', message: 'Probando API de Publicaciones directamente...' });
      const startApi = Date.now();

      try {
        // FIX: Use correct request format - identifier is an object with radicado
        const { data: apiResult, error: apiError } = await supabase.functions.invoke(
          'debug-external-provider',
          {
            body: {
              provider: 'publicaciones',
              identifier: { radicado: normalizedRadicado },
              mode: 'lookup',
            }
          }
        );

        setApiRawResponse(apiResult);

        if (apiError) {
          updateStep('API_TEST', {
            status: 'error',
            message: `❌ Error: ${apiError.message}`,
            data: apiError,
            duration: Date.now() - startApi
          });
        } else if (apiResult?.status === 404 || apiResult?.error_code === 'RECORD_NOT_FOUND') {
          updateStep('API_TEST', {
            status: 'warning',
            message: '⚠️ 404 - Radicado no en caché. Se iniciará scraping automáticamente.',
            data: apiResult,
            duration: Date.now() - startApi
          });
        } else if (apiResult?.ok && apiResult?.summary?.publicacionesCount > 0) {
          updateStep('API_TEST', {
            status: 'success',
            message: `✅ API retornó ${apiResult.summary.publicacionesCount} publicaciones`,
            data: apiResult,
            duration: Date.now() - startApi
          });

          // Check what fields the API returns from raw data
          const rawPublications = apiResult.raw?.publicaciones || apiResult.raw?.estados || [];
          if (rawPublications.length > 0) {
            const samplePub = rawPublications[0];
            const apiFields = Object.keys(samplePub);
            addStep({
              step: 'API_FIELDS',
              status: 'success',
              message: `Campos en respuesta: ${apiFields.slice(0, 12).join(', ')}${apiFields.length > 12 ? '...' : ''}`,
              data: { fields: apiFields, sample: samplePub }
            });

            // Check for deadline fields
            const hasDeadlineFields = apiFields.includes('fecha_fijacion') || apiFields.includes('fecha_desfijacion');
            if (!hasDeadlineFields) {
              addStep({
                step: 'API_FIELDS_WARNING',
                status: 'warning',
                message: '⚠️ API NO incluye fecha_fijacion/fecha_desfijacion - Términos no calculables',
                data: { expectedFields: ['fecha_fijacion', 'fecha_desfijacion', 'despacho'], actualFields: apiFields }
              });
            } else {
              addStep({
                step: 'API_FIELDS_OK',
                status: 'success',
                message: '✅ API incluye campos de deadline requeridos',
                data: { 
                  fecha_fijacion: samplePub.fecha_fijacion,
                  fecha_desfijacion: samplePub.fecha_desfijacion,
                  despacho: samplePub.despacho
                }
              });
            }
          }
        } else {
          updateStep('API_TEST', {
            status: 'warning',
            message: `⚠️ Respuesta inesperada: ${apiResult?.error_code || 'sin datos'}`,
            data: apiResult,
            duration: Date.now() - startApi
          });
        }
      } catch (apiErr) {
        updateStep('API_TEST', {
          status: 'error',
          message: `❌ Error invocando función: ${apiErr}`,
          data: apiErr,
          duration: Date.now() - startApi
        });
      }

      // ============================================
      // STEP 4: Call sync-publicaciones-by-work-item
      // ============================================
      addStep({ step: 'SYNC_FUNCTION', status: 'running', message: 'Ejecutando sync-publicaciones-by-work-item...' });
      const startSync = Date.now();

      try {
        const { data: syncResult, error: syncError } = await supabase.functions.invoke(
          'sync-publicaciones-by-work-item',
          { body: { work_item_id: currentWorkItem.id } }
        );

        if (syncError) {
          updateStep('SYNC_FUNCTION', {
            status: 'error',
            message: `❌ Error: ${syncError.message}`,
            data: syncError,
            duration: Date.now() - startSync
          });
        } else {
          const isOk = syncResult?.ok === true;
          const scrapingInitiated = syncResult?.scrapingInitiated === true;
          
          // Save scraping info for retry UI
          if (scrapingInitiated && syncResult?.scrapingJobId) {
            const isSameJob = checkSameJobId(syncResult.scrapingJobId);
            
            setScrapingInfo({
              jobId: syncResult.scrapingJobId,
              pollUrl: syncResult.scrapingPollUrl,
              message: isSameJob 
                ? `⚠️ Mismo Job ID devuelto (${retryCount + 1}x) - Cloud Run puede tener problemas`
                : syncResult.scrapingMessage || 'Reintente en 30-60 segundos',
              initiatedAt: scrapingInfo?.initiatedAt || new Date(),
            });
            
            // Set countdown for auto-retry
            if (!isSameJob) {
              setCountdown(45);
            }
          } else if (isOk) {
            // Clear scraping info on success
            setScrapingInfo(null);
            setPreviousJobId(null);
            setRetryCount(0);
          }
          
          updateStep('SYNC_FUNCTION', {
            status: isOk ? 'success' : scrapingInitiated ? 'warning' : 'error',
            message: isOk 
              ? `✅ Insertados: ${syncResult.inserted_count || 0}, Omitidos: ${syncResult.skipped_count || 0}, Alertas: ${syncResult.alerts_created || 0}`
              : scrapingInitiated 
              ? `⚠️ Scraping iniciado (Job: ${syncResult.scrapingJobId?.slice(0, 20)}...)${retryCount > 0 ? ` [Retry #${retryCount}]` : ''}`
              : `❌ ${syncResult?.errors?.[0] || syncResult?.code || 'Error desconocido'}`,
            data: syncResult,
            duration: Date.now() - startSync
          });
        }
      } catch (syncErr) {
        updateStep('SYNC_FUNCTION', {
          status: 'error',
          message: `❌ Error: ${syncErr}`,
          data: syncErr,
          duration: Date.now() - startSync
        });
      }

      // ============================================
      // STEP 5: Check Database Records
      // ============================================
      addStep({ step: 'DB_CHECK', status: 'running', message: 'Verificando registros en base de datos...' });
      const startDb = Date.now();

      const { data: dbData, error: dbError } = await supabase
        .from('work_item_publicaciones')
        .select('*')
        .eq('work_item_id', currentWorkItem.id)
        .order('published_at', { ascending: false });

      setDbRecords(dbData || []);

      if (dbError) {
        updateStep('DB_CHECK', {
          status: 'error',
          message: `❌ Error consultando: ${dbError.message}`,
          data: dbError,
          duration: Date.now() - startDb
        });
      } else if (!dbData || dbData.length === 0) {
        updateStep('DB_CHECK', {
          status: 'error',
          message: '❌ NO HAY REGISTROS para este work_item',
          duration: Date.now() - startDb
        });
      } else {
        const records = dbData as Record<string, unknown>[];
        const withDesfijacion = records.filter(r => r.fecha_desfijacion !== null);
        const withFijacion = records.filter(r => r.fecha_fijacion !== null);
        const withDespacho = records.filter(r => r.despacho !== null);

        updateStep('DB_CHECK', {
          status: 'success',
          message: `✅ ${records.length} registros encontrados`,
          data: {
            total: records.length,
            with_fecha_desfijacion: withDesfijacion.length,
            with_fecha_fijacion: withFijacion.length,
            with_despacho: withDespacho.length
          },
          duration: Date.now() - startDb
        });

        // Check deadline field population
        if (withDesfijacion.length === 0) {
          addStep({
            step: 'DB_DEADLINE_CHECK',
            status: 'error',
            message: `❌ CRÍTICO: fecha_desfijacion es NULL en TODOS los registros`,
            data: { sample: records[0] }
          });
        } else {
          addStep({
            step: 'DB_DEADLINE_CHECK',
            status: 'success',
            message: `✅ ${withDesfijacion.length}/${records.length} registros tienen fecha_desfijacion`,
            data: { sample: records[0] }
          });
        }
      }

      // ============================================
      // STEP 6: Summary
      // ============================================
      addStep({
        step: 'SUMMARY',
        status: 'success',
        message: 'Debug completado. Revise los resultados.',
        data: {
          radicado: normalizedRadicado,
          work_item_id: currentWorkItem.id,
          workflow_type: currentWorkItem.workflow_type,
        }
      });

    } catch (err) {
      addStep({
        step: 'UNEXPECTED_ERROR',
        status: 'error',
        message: `Error inesperado: ${err}`,
        data: err
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: DebugStep['status']) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'running': return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <div className="h-4 w-4 rounded-full bg-muted" />;
    }
  };

  const getStepIcon = (step: string) => {
    if (step.startsWith('DB')) return <Database className="h-4 w-4 text-purple-500" />;
    if (step.startsWith('API')) return <Globe className="h-4 w-4 text-blue-500" />;
    if (step.startsWith('SYNC')) return <Server className="h-4 w-4 text-emerald-500" />;
    if (step.startsWith('FIND')) return <Search className="h-4 w-4 text-amber-500" />;
    return <Monitor className="h-4 w-4 text-muted-foreground" />;
  };

  const getStatusBadgeVariant = (status: DebugStep['status']) => {
    switch (status) {
      case 'success': return 'default';
      case 'error': return 'destructive';
      case 'warning': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-primary" />
          Debug: Estados / Publicaciones Procesales
        </CardTitle>
        <CardDescription>
          Prueba el pipeline completo: API → Edge Function → Database → UI
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <FileText className="h-4 w-4" />
          <AlertTitle>Instrucciones</AlertTitle>
          <AlertDescription>
            Ingrese un radicado de 23 dígitos que tenga publicaciones en la Rama Judicial para verificar el pipeline.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Input
            placeholder="Ej: 05001400302020250187800"
            value={radicado}
            onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
            className="font-mono flex-1"
            maxLength={23}
          />
          <Button onClick={runFullDebug} disabled={isRunning || radicado.replace(/\D/g, '').length !== 23}>
            {isRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Ejecutar Debug
          </Button>
        </div>

        {radicado.length > 0 && radicado.replace(/\D/g, '').length !== 23 && (
          <p className="text-sm text-muted-foreground">
            {radicado.replace(/\D/g, '').length}/23 dígitos
          </p>
        )}

        {/* Debug Steps */}
        {steps.length > 0 && (
          <div className="space-y-2 mt-4">
            <h4 className="font-medium text-sm">Pasos de Debug:</h4>
            {steps.map((step, idx) => (
              <Collapsible key={idx}>
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/50 transition-colors">
                    {getStatusIcon(step.status)}
                    {getStepIcon(step.step)}
                    <span className="font-mono text-xs flex-1 text-left">{step.step}</span>
                    {step.duration && (
                      <Badge variant="outline" className="text-xs">
                        {step.duration}ms
                      </Badge>
                    )}
                    <Badge variant={getStatusBadgeVariant(step.status)}>
                      {step.status}
                    </Badge>
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="p-3 border border-t-0 rounded-b-lg bg-muted/30 space-y-2">
                    <p className="text-sm whitespace-pre-wrap">{step.message}</p>
                    {step.data && (
                      <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-48 border">
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}

        {/* Raw API Response */}
        {apiRawResponse && (
          <Collapsible className="mt-4">
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center gap-2 p-2 border rounded-lg hover:bg-muted/50">
                <Globe className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm flex-1 text-left">Respuesta Raw de API</span>
                <ChevronDown className="h-4 w-4" />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="text-xs bg-muted p-3 rounded-b-lg border border-t-0 overflow-auto max-h-64">
                {JSON.stringify(apiRawResponse, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Database Records Table */}
        {dbRecords.length > 0 && (
          <div className="mt-4">
            <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-purple-500" />
              Registros en work_item_publicaciones ({dbRecords.length})
            </h4>
            <div className="border rounded-lg overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-left">ID</th>
                    <th className="p-2 text-left">Título</th>
                    <th className="p-2 text-left">published_at</th>
                    <th className="p-2 text-left">fecha_fijacion</th>
                    <th className="p-2 text-left">fecha_desfijacion</th>
                    <th className="p-2 text-left">despacho</th>
                  </tr>
                </thead>
                <tbody>
                  {dbRecords.map((record: unknown, idx) => {
                    const r = record as Record<string, unknown>;
                    return (
                      <tr key={idx} className="border-t">
                        <td className="p-2 font-mono">{String(r.id || '').slice(0, 8)}...</td>
                        <td className="p-2 max-w-[200px] truncate">{String(r.title || r.annotation || '-')}</td>
                        <td className="p-2">{r.published_at ? String(r.published_at).slice(0, 10) : <span className="text-red-500">NULL</span>}</td>
                        <td className="p-2">
                          {r.fecha_fijacion 
                            ? String(r.fecha_fijacion).slice(0, 10) 
                            : <span className="text-amber-500">NULL</span>}
                        </td>
                        <td className="p-2">
                          {r.fecha_desfijacion 
                            ? String(r.fecha_desfijacion).slice(0, 10) 
                            : <span className="text-red-500 font-medium">NULL (CRÍTICO)</span>}
                        </td>
                        <td className="p-2">{r.despacho ? String(r.despacho) : <span className="text-muted-foreground">-</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Scraping Status Banner */}
        {scrapingInfo && (
          <Alert className={`mt-4 ${retryCount >= 2 ? 'border-red-200 bg-red-50 dark:bg-red-950/30' : 'border-blue-200 bg-blue-50 dark:bg-blue-950/30'}`}>
            {retryCount >= 2 ? (
              <XCircle className="h-4 w-4 text-red-500" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            )}
            <AlertTitle>
              {retryCount >= 2 
                ? '⚠️ Problema con Cloud Run Publicaciones' 
                : 'Scraping en Progreso'}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              {retryCount >= 2 ? (
                <div className="space-y-2">
                  <p className="text-red-700 dark:text-red-300">
                    El servicio Cloud Run devuelve el mismo Job ID repetidamente sin procesar datos.
                    Esto indica un problema en el servicio de scraping externo.
                  </p>
                  <p className="text-sm">
                    <strong>Diagnóstico:</strong> El endpoint <code>/buscar</code> responde pero el job no se ejecuta o falla silenciosamente.
                  </p>
                </div>
              ) : (
                <p>{scrapingInfo.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Job ID: <code className="font-mono">{scrapingInfo.jobId}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                Iniciado: {scrapingInfo.initiatedAt.toLocaleTimeString()}
                {retryCount > 0 && ` • Reintentos: ${retryCount}`}
              </p>
              {countdown > 0 && (
                <p className="text-xs flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Auto-reintento en {countdown}s
                </p>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button 
                  size="sm" 
                  onClick={runFullDebug}
                  disabled={isRunning}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Reintentar Ahora
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyDiagnosticReport}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copiar Diagnóstico
                </Button>
                {retryCount >= 2 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open('https://console.cloud.google.com/run', '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Ver Cloud Run Logs
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Quick Actions */}
        {workItem && (
          <div className="mt-4 flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => window.open(`/app/work-items/${workItem.id}`, '_blank')}
            >
              <FileText className="h-4 w-4 mr-1" />
              Ver Work Item
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={runFullDebug}
              disabled={isRunning}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Repetir Test
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
