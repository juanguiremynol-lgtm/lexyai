/**
 * API Test Tab - Test single provider with radicado
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Play, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  ChevronDown,
  Clock,
  Copy,
  Download,
  Database,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type ProviderName = 'cpnu' | 'samai' | 'tutelas' | 'publicaciones';
type WorkflowType = 'CGP' | 'LABORAL' | 'CPACA' | 'TUTELA' | 'PENAL_906';

const WORKFLOW_CONFIG: Record<WorkflowType, { primary: ProviderName; description: string }> = {
  CGP: { primary: 'cpnu', description: 'CPNU primario, SAMAI fallback' },
  LABORAL: { primary: 'cpnu', description: 'CPNU primario, SAMAI fallback' },
  CPACA: { primary: 'samai', description: 'SAMAI primario (administrativo)' },
  TUTELA: { primary: 'tutelas', description: 'TUTELAS API primario' },
  PENAL_906: { primary: 'publicaciones', description: 'Publicaciones es PRIMARY' },
};

interface DebugResult {
  ok: boolean;
  provider_used: string;
  status: number;
  latencyMs: number;
  summary: {
    found: boolean;
    actuacionesCount?: number;
    publicacionesCount?: number;
  };
  raw: unknown;
  error?: string;
}

export function ApiTestTab() {
  const [workflowType, setWorkflowType] = useState<WorkflowType>('CGP');
  const [provider, setProvider] = useState<ProviderName>('cpnu');
  const [radicado, setRadicado] = useState('');
  const [result, setResult] = useState<DebugResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Test provider mutation
  const testMutation = useMutation({
    mutationFn: async (saveToDb: boolean) => {
      const normalized = radicado.replace(/\D/g, '');
      if (normalized.length !== 23) {
        throw new Error('Radicado debe tener 23 dígitos');
      }

      // Test API
      const { data, error } = await supabase.functions.invoke<DebugResult>(
        'debug-external-provider',
        {
          body: {
            provider,
            identifier: { radicado: normalized },
            mode: 'lookup',
            timeoutMs: 15000,
          },
        }
      );

      if (error) throw error;
      
      let dbResult = null;
      
      // If saveToDb, also run sync
      if (saveToDb && data?.ok) {
        // First find/create work item
        const { data: workItem } = await supabase
          .from('work_items')
          .select('id')
          .eq('radicado', normalized)
          .maybeSingle();

        if (workItem) {
          // Run sync
          const [actsSync, pubsSync] = await Promise.allSettled([
            supabase.functions.invoke('sync-by-work-item', {
              body: { work_item_id: workItem.id }
            }),
            supabase.functions.invoke('sync-publicaciones-by-work-item', {
              body: { work_item_id: workItem.id }
            }),
          ]);

          dbResult = {
            actuaciones: actsSync.status === 'fulfilled' ? actsSync.value.data : null,
            publicaciones: pubsSync.status === 'fulfilled' ? pubsSync.value.data : null,
          };
        }
      }

      return { apiResult: data, dbResult };
    },
    onSuccess: ({ apiResult }) => {
      setResult(apiResult);
      if (apiResult?.ok && apiResult.summary?.found) {
        toast.success(`${apiResult.provider_used.toUpperCase()} respondió correctamente`);
      } else if (apiResult?.ok) {
        toast.info('Provider respondió pero no encontró datos');
      } else {
        toast.warning(`Error: ${apiResult?.error || 'Unknown'}`);
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Error desconocido');
      setResult(null);
    },
  });

  const copyJson = () => {
    if (result?.raw) {
      navigator.clipboard.writeText(JSON.stringify(result.raw, null, 2));
      toast.success('JSON copiado');
    }
  };

  const downloadJson = () => {
    if (result?.raw) {
      const blob = new Blob([JSON.stringify(result.raw, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `debug-${provider}-${radicado}.json`;
      a.click();
    }
  };

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Flujo de Trabajo</Label>
          <Select 
            value={workflowType} 
            onValueChange={(v) => {
              setWorkflowType(v as WorkflowType);
              setProvider(WORKFLOW_CONFIG[v as WorkflowType].primary);
            }}
          >
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
          <p className="text-xs text-muted-foreground">
            {WORKFLOW_CONFIG[workflowType].description}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Proveedor</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as ProviderName)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cpnu">CPNU</SelectItem>
              <SelectItem value="samai">SAMAI</SelectItem>
              <SelectItem value="publicaciones">PUBLICACIONES</SelectItem>
              <SelectItem value="tutelas">TUTELAS</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Radicado (23 dígitos)</Label>
          <Input
            placeholder="05001400302320250063800"
            value={radicado}
            onChange={(e) => setRadicado(e.target.value.replace(/\D/g, '').slice(0, 23))}
            className="font-mono"
          />
          {radicado && radicado.length !== 23 && (
            <p className="text-xs text-muted-foreground">{radicado.length}/23</p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={() => testMutation.mutate(false)}
          disabled={testMutation.isPending || radicado.length !== 23}
        >
          {testMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Solo Probar API
        </Button>
        <Button
          variant="secondary"
          onClick={() => testMutation.mutate(true)}
          disabled={testMutation.isPending || radicado.length !== 23}
        >
          {testMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Database className="h-4 w-4 mr-2" />
          )}
          Probar + Guardar en DB
        </Button>
      </div>

      {/* Results */}
      {result && (
        <div className={cn(
          "rounded-lg border p-4 space-y-4",
          result.ok ? "bg-emerald-500/5 border-emerald-500/30" : "bg-destructive/5 border-destructive/30"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {result.ok ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <div>
                <span className="font-medium">Resultado: {result.provider_used?.toUpperCase()}</span>
                <div className="flex gap-2 text-sm text-muted-foreground">
                  <span>HTTP {result.status}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {result.latencyMs}ms
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {result.summary?.found && (
                <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700">
                  ✅ Encontrado
                </Badge>
              )}
              {result.summary?.actuacionesCount && (
                <Badge variant="outline">{result.summary.actuacionesCount} Actuaciones</Badge>
              )}
              {result.summary?.publicacionesCount && (
                <Badge variant="outline">{result.summary.publicacionesCount} Publicaciones</Badge>
              )}
            </div>
          </div>

          {/* Raw Response */}
          <Collapsible open={showRaw} onOpenChange={setShowRaw}>
            <div className="flex items-center justify-between">
              <CollapsibleTrigger className="flex items-center gap-2 text-sm hover:text-primary">
                <ChevronDown className={cn("h-4 w-4 transition-transform", showRaw && "rotate-180")} />
                Ver Respuesta Raw
              </CollapsibleTrigger>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={copyJson}>
                  <Copy className="h-3 w-3 mr-1" />
                  Copiar
                </Button>
                <Button variant="ghost" size="sm" onClick={downloadJson}>
                  <Download className="h-3 w-3 mr-1" />
                  Descargar
                </Button>
              </div>
            </div>
            <CollapsibleContent>
              <ScrollArea className="h-64 mt-2 rounded border bg-muted/30 p-3">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
