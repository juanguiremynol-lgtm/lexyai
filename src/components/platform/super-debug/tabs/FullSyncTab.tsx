/**
 * Full Sync Tab - Complete pipeline debug for a single radicado
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Play, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ChevronDown,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface DebugStep {
  id: string;
  section: 'actuaciones' | 'publicaciones' | 'summary';
  step: number;
  title: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'error';
  message: string;
  data?: unknown;
  duration?: number;
  timestamp?: string;
}

export function FullSyncTab() {
  const [radicado, setRadicado] = useState('');
  const [steps, setSteps] = useState<DebugStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [workItemId, setWorkItemId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addStep = (step: Omit<DebugStep, 'id'>) => {
    const id = `${step.section}-${step.step}`;
    setSteps(prev => [...prev, { ...step, id, timestamp: new Date().toLocaleTimeString() }]);
    return id;
  };

  const updateStep = (id: string, update: Partial<DebugStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  };

  const runDebugMutation = useMutation({
    mutationFn: async () => {
      const normalized = radicado.replace(/\D/g, '');
      if (normalized.length !== 23) {
        throw new Error('Radicado debe tener 23 dígitos');
      }

      setSteps([]);
      setWorkItemId(null);

      // ========== ACTUACIONES SECTION ==========
      
      // Step 1: API Test
      const actApiId = addStep({
        section: 'actuaciones',
        step: 1,
        title: 'API Test',
        status: 'running',
        message: 'Probando CPNU/SAMAI...',
      });

      const actApiStart = Date.now();
      const { data: actApiData, error: actApiError } = await supabase.functions.invoke(
        'debug-external-provider',
        { body: { provider: 'cpnu', identifier: { radicado: normalized }, mode: 'lookup' } }
      );

      updateStep(actApiId, {
        status: actApiError ? 'error' : actApiData?.ok ? 'success' : 'warning',
        message: actApiError 
          ? `❌ Error: ${actApiError.message}`
          : actApiData?.ok 
            ? `CPNU respondió OK. ${actApiData.summary?.actuacionesCount || 0} actuaciones encontradas.`
            : `⚠️ ${actApiData?.error_code || 'Sin datos'}`,
        data: actApiData,
        duration: Date.now() - actApiStart,
      });

      // Step 2: Find work item
      const findId = addStep({
        section: 'actuaciones',
        step: 2,
        title: 'BD: work_item',
        status: 'running',
        message: 'Buscando work_item...',
      });

      const { data: workItem } = await supabase
        .from('work_items')
        .select('id, radicado, workflow_type, organization_id')
        .eq('radicado', normalized)
        .maybeSingle();

      if (!workItem) {
        updateStep(findId, {
          status: 'error',
          message: '❌ No existe work_item con este radicado',
        });
        return;
      }

      setWorkItemId(workItem.id);
      updateStep(findId, {
        status: 'success',
        message: `✅ Encontrado: ${workItem.workflow_type} (${workItem.id.slice(0, 8)}...)`,
        data: workItem,
      });

      // Step 3: Sync actuaciones
      const actSyncId = addStep({
        section: 'actuaciones',
        step: 3,
        title: 'Sync: sync-by-work-item',
        status: 'running',
        message: 'Ejecutando sync...',
      });

      const actSyncStart = Date.now();
      const { data: actSyncData, error: actSyncError } = await supabase.functions.invoke(
        'sync-by-work-item',
        { body: { work_item_id: workItem.id } }
      );

      updateStep(actSyncId, {
        status: actSyncError ? 'error' : actSyncData?.ok !== false ? 'success' : 'warning',
        message: actSyncError 
          ? `❌ Error: ${actSyncError.message}`
          : `Sync OK. Insertados: ${actSyncData?.inserted_count || 0}, Omitidos: ${actSyncData?.skipped_count || 0}`,
        data: actSyncData,
        duration: Date.now() - actSyncStart,
      });

      // Step 4: Verify post-sync
      const actVerifyId = addStep({
        section: 'actuaciones',
        step: 4,
        title: 'Verificación post-sync',
        status: 'running',
        message: 'Verificando registros en BD...',
      });

      const { data: actCount, count: actDbCount } = await supabase
        .from('work_item_acts')
        .select('id', { count: 'exact', head: true })
        .eq('work_item_id', workItem.id)
        .eq('is_archived', false);

      updateStep(actVerifyId, {
        status: 'success',
        message: `${actDbCount || 0} actuaciones en BD después de sync`,
        data: { count: actDbCount },
      });

      // ========== PUBLICACIONES SECTION ==========

      // Step 1: API Test
      const pubApiId = addStep({
        section: 'publicaciones',
        step: 1,
        title: 'API Test',
        status: 'running',
        message: 'Probando Publicaciones API...',
      });

      const pubApiStart = Date.now();
      const { data: pubApiData, error: pubApiError } = await supabase.functions.invoke(
        'debug-external-provider',
        { body: { provider: 'publicaciones', identifier: { radicado: normalized }, mode: 'lookup' } }
      );

      updateStep(pubApiId, {
        status: pubApiError ? 'error' : pubApiData?.ok ? 'success' : 'warning',
        message: pubApiError 
          ? `❌ Error: ${pubApiError.message}`
          : pubApiData?.ok 
            ? `API respondió OK. ${pubApiData.summary?.publicacionesCount || 0} publicación(es) encontrada(s).`
            : `⚠️ ${pubApiData?.error_code || 'Sin datos'}`,
        data: pubApiData,
        duration: Date.now() - pubApiStart,
      });

      // Step 2: Check DB before
      const pubDbBeforeId = addStep({
        section: 'publicaciones',
        step: 2,
        title: 'BD: work_item_publicaciones',
        status: 'running',
        message: 'Verificando registros existentes...',
      });

      const { count: pubDbBeforeCount } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('work_item_id', workItem.id)
        .eq('is_archived', false);

      updateStep(pubDbBeforeId, {
        status: 'success',
        message: `${pubDbBeforeCount || 0} publicación(es) en BD antes de sync`,
        data: { count: pubDbBeforeCount },
      });

      // Step 3: Sync publicaciones
      const pubSyncId = addStep({
        section: 'publicaciones',
        step: 3,
        title: 'Sync: sync-publicaciones-by-work-item',
        status: 'running',
        message: 'Ejecutando sync...',
      });

      const pubSyncStart = Date.now();
      const { data: pubSyncData, error: pubSyncError } = await supabase.functions.invoke(
        'sync-publicaciones-by-work-item',
        { body: { work_item_id: workItem.id } }
      );

      updateStep(pubSyncId, {
        status: pubSyncError ? 'error' : pubSyncData?.ok !== false ? 'success' : 'warning',
        message: pubSyncError 
          ? `❌ Error: ${pubSyncError.message}`
          : pubSyncData?.status === 'EMPTY'
            ? `📭 Sin publicaciones (provider retornó vacío)`
            : `Sync OK. Insertados: ${pubSyncData?.inserted_count || 0}, Omitidos: ${pubSyncData?.skipped_count || 0}`,
        data: pubSyncData,
        duration: Date.now() - pubSyncStart,
      });

      // Step 4: Verify post-sync
      const pubVerifyId = addStep({
        section: 'publicaciones',
        step: 4,
        title: 'Verificación post-sync',
        status: 'running',
        message: 'Verificando registros en BD...',
      });

      const { count: pubDbAfterCount } = await supabase
        .from('work_item_publicaciones')
        .select('id', { count: 'exact', head: true })
        .eq('work_item_id', workItem.id)
        .eq('is_archived', false);

      updateStep(pubVerifyId, {
        status: 'success',
        message: `${pubDbAfterCount || 0} publicación(es) en BD después de sync`,
        data: { count: pubDbAfterCount },
      });

      // ========== SUMMARY ==========
      addStep({
        section: 'summary',
        step: 1,
        title: 'Resumen',
        status: 'success',
        message: 'Debug completado',
        data: {
          work_item_id: workItem.id,
          workflow_type: workItem.workflow_type,
          actuaciones_count: actDbCount,
          publicaciones_count: pubDbAfterCount,
        },
      });

      return { workItem, actDbCount, pubDbAfterCount };
    },
    onSuccess: (data) => {
      if (data) {
        toast.success('Debug completado');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Error');
    },
  });

  const getStatusIcon = (status: DebugStep['status']) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error': return <XCircle className="h-4 w-4 text-destructive" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderStepsBySection = (section: 'actuaciones' | 'publicaciones' | 'summary') => {
    const sectionSteps = steps.filter(s => s.section === section);
    if (sectionSteps.length === 0) return null;

    return (
      <div className="space-y-2">
        {sectionSteps.map((step) => (
          <Collapsible 
            key={step.id}
            open={expandedSteps.has(step.id)}
            onOpenChange={() => toggleExpand(step.id)}
          >
            <div className={cn(
              "rounded-lg border p-3",
              step.status === 'error' && "border-destructive/50 bg-destructive/5",
              step.status === 'warning' && "border-amber-500/50 bg-amber-500/5",
              step.status === 'success' && "border-emerald-500/50 bg-emerald-500/5",
              step.status === 'running' && "border-primary/50 bg-primary/5",
            )}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(step.status)}
                    <span className="font-medium text-sm">{step.step}️⃣ {step.title}</span>
                    {step.timestamp && (
                      <span className="text-xs text-muted-foreground">{step.timestamp}</span>
                    )}
                    {step.duration && (
                      <Badge variant="outline" className="text-xs">
                        {step.duration}ms
                      </Badge>
                    )}
                  </div>
                  <ChevronDown className={cn(
                    "h-4 w-4 transition-transform",
                    expandedSteps.has(step.id) && "rotate-180"
                  )} />
                </div>
              </CollapsibleTrigger>
              <p className="text-sm mt-2 text-muted-foreground">{step.message}</p>
              {step.data && (
                <CollapsibleContent>
                  <ScrollArea className="h-32 mt-2 rounded bg-muted/50 p-2">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(step.data, null, 2)}
                    </pre>
                  </ScrollArea>
                </CollapsibleContent>
              )}
            </div>
          </Collapsible>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="flex gap-4 items-end">
        <div className="flex-1 space-y-2">
          <Label>Radicado (23 dígitos)</Label>
          <Input
            placeholder="05001400302320250063800"
            value={radicado}
            onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
            className="font-mono"
          />
        </div>
        <Button
          onClick={() => runDebugMutation.mutate()}
          disabled={runDebugMutation.isPending || radicado.length !== 23}
        >
          {runDebugMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Ejecutar Debug Completo
        </Button>
      </div>

      {/* Results */}
      {steps.length > 0 && (
        <div className="space-y-6">
          {/* Actuaciones Section */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm border-b pb-2">
              ═══ ACTUACIONES (CPNU/SAMAI) ═══
            </h3>
            {renderStepsBySection('actuaciones')}
          </div>

          {/* Publicaciones Section */}
          <div className="space-y-3">
            <h3 className="font-medium text-sm border-b pb-2">
              ═══ PUBLICACIONES (Publicaciones Procesales) ═══
            </h3>
            {renderStepsBySection('publicaciones')}
          </div>

          {/* Summary */}
          {steps.some(s => s.section === 'summary') && (
            <div className="space-y-3">
              <h3 className="font-medium text-sm border-b pb-2">
                ═══ RESUMEN ═══
              </h3>
              {renderStepsBySection('summary')}
              
              {workItemId && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/app/work-items/${workItemId}`} target="_blank" rel="noopener">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Ver en UI →
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
