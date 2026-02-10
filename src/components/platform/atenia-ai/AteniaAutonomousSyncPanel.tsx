/**
 * AteniaAutonomousSyncPanel (B4)
 *
 * Admin panel section showing autonomous sync status, forced check,
 * pause/resume controls, and last check results.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Activity,
  Loader2,
  PlayCircle,
  PauseCircle,
  Zap,
  Clock,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  evaluatePostCronHealth,
  evaluateFailedItems,
  executeTargetedSync,
  getRecentProviderHealth,
  isWithinDailyCronWindowCOT,
  isAutonomyPaused,
  type SyncDecision,
  type ProviderHealth,
} from '@/lib/services/atenia-ai-autonomous-sync';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface Props {
  organizationId: string;
}

export function AteniaAutonomousSyncPanel({ organizationId }: Props) {
  const queryClient = useQueryClient();
  const [isChecking, setIsChecking] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [checkResults, setCheckResults] = useState<{
    postCron: SyncDecision;
    failedItems: SyncDecision;
    providerHealth: ProviderHealth[];
  } | null>(null);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);

  // Load config state
  const { data: configState } = useQuery({
    queryKey: ['atenia-autonomy-state', organizationId],
    queryFn: async () => {
      const { data } = await (supabase
        .from('atenia_ai_config') as any)
        .select('autonomy_paused, paused_until, last_auto_sync_at, auto_sync_cooldown_minutes')
        .eq('organization_id', organizationId)
        .maybeSingle();
      return {
        autonomy_paused: data?.autonomy_paused ?? false,
        paused_until: data?.paused_until ?? null,
        last_auto_sync_at: data?.last_auto_sync_at ?? null,
        cooldown_minutes: data?.auto_sync_cooldown_minutes ?? 30,
      };
    },
    staleTime: 1000 * 30,
  });

  // Last heartbeat action
  const { data: lastHeartbeat } = useQuery({
    queryKey: ['atenia-last-heartbeat', organizationId],
    queryFn: async () => {
      const { data } = await (supabase
        .from('atenia_ai_actions') as any)
        .select('action_type, created_at, reasoning, action_result')
        .eq('organization_id', organizationId)
        .in('action_type', ['heartbeat_observe', 'auto_sync_triggered', 'auto_sync_completed', 'auto_sync_skipped'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    staleTime: 1000 * 60,
  });

  const handleForceCheck = async () => {
    setIsChecking(true);
    setCheckResults(null);
    try {
      const [postCron, failedItems, providerHealth] = await Promise.all([
        evaluatePostCronHealth(organizationId),
        evaluateFailedItems(organizationId),
        getRecentProviderHealth(organizationId, 45, 400),
      ]);

      setCheckResults({ postCron, failedItems, providerHealth });
      toast.success('Chequeo completado');
    } catch (err: any) {
      toast.error('Error en chequeo: ' + (err.message || 'desconocido'));
    } finally {
      setIsChecking(false);
    }
  };

  const handleExecuteSync = async (decision: SyncDecision) => {
    setIsExecuting(true);
    setSyncProgress(null);
    try {
      const result = await executeTargetedSync(
        organizationId,
        decision,
        (done, total) => setSyncProgress({ done, total }),
      );
      toast.success(`Sync completado: ${result.succeeded}/${result.total} exitosos`);
      queryClient.invalidateQueries({ queryKey: ['atenia-last-heartbeat'] });
      queryClient.invalidateQueries({ queryKey: ['atenia-autonomy-state'] });
      queryClient.invalidateQueries({ queryKey: ['atenia-actions'] });
    } catch (err: any) {
      toast.error('Error en sync: ' + (err.message || 'desconocido'));
    } finally {
      setIsExecuting(false);
      setSyncProgress(null);
    }
  };

  const handleTogglePause = async () => {
    setIsPausing(true);
    try {
      const currentlyPaused = configState?.autonomy_paused ?? false;
      const update: any = { autonomy_paused: !currentlyPaused };

      if (!currentlyPaused) {
        // Pausing: set paused_until to now + 2 hours
        update.paused_until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      } else {
        // Resuming: clear paused_until
        update.paused_until = null;
      }

      await (supabase
        .from('atenia_ai_config') as any)
        .upsert(
          { organization_id: organizationId, ...update, updated_at: new Date().toISOString() },
          { onConflict: 'organization_id' },
        );

      // Log action
      await (supabase.from('atenia_ai_actions') as any).insert({
        organization_id: organizationId,
        action_type: currentlyPaused ? 'autonomy_resumed' : 'autonomy_paused',
        autonomy_tier: 'OBSERVE',
        reasoning: currentlyPaused
          ? 'Administrador reactivó la autonomía de Atenia AI.'
          : 'Administrador pausó la autonomía de Atenia AI (2 horas).',
        evidence: { paused_until: update.paused_until },
        action_result: 'applied',
      });

      toast.success(currentlyPaused ? 'Autonomía reactivada' : 'Autonomía pausada (2 horas)');
      queryClient.invalidateQueries({ queryKey: ['atenia-autonomy-state'] });
      queryClient.invalidateQueries({ queryKey: ['atenia-config'] });
    } catch (err: any) {
      toast.error('Error: ' + (err.message || 'desconocido'));
    } finally {
      setIsPausing(false);
    }
  };

  const isPaused = configState?.autonomy_paused ?? false;
  const inCronWindow = isWithinDailyCronWindowCOT();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Sincronización Autónoma
          </CardTitle>
          <div className="flex items-center gap-2">
            {isPaused ? (
              <Badge variant="secondary" className="text-xs gap-1">
                <PauseCircle className="h-3 w-3" />
                Pausada
              </Badge>
            ) : (
              <Badge variant="default" className="text-xs gap-1">
                <PlayCircle className="h-3 w-3" />
                Activa
              </Badge>
            )}
            {inCronWindow && (
              <Badge variant="outline" className="text-xs gap-1">
                <Clock className="h-3 w-3" />
                Ventana Cron
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status info */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Estado:</span>{' '}
            <span className="font-medium">
              {isPaused ? '⏸️ Pausada' : inCronWindow ? '⏳ Ventana cron' : '▶️ Activa'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Cooldown:</span>{' '}
            <span className="font-medium">{configState?.cooldown_minutes ?? 30} min</span>
          </div>
          <div>
            <span className="text-muted-foreground">Último auto-sync:</span>{' '}
            <span className="font-medium">
              {configState?.last_auto_sync_at
                ? formatDistanceToNow(new Date(configState.last_auto_sync_at), { addSuffix: true, locale: es })
                : 'Nunca'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Último chequeo:</span>{' '}
            <span className="font-medium">
              {lastHeartbeat?.created_at
                ? formatDistanceToNow(new Date(lastHeartbeat.created_at), { addSuffix: true, locale: es })
                : 'Sin datos'}
            </span>
          </div>
        </div>

        {isPaused && configState?.paused_until && (
          <div className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Pausada hasta: {new Date(configState.paused_until).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
          </div>
        )}

        <Separator />

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleForceCheck}
            disabled={isChecking}
            className="gap-1.5 text-xs"
          >
            {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Forzar Chequeo Ahora
          </Button>
          <Button
            variant={isPaused ? 'default' : 'secondary'}
            size="sm"
            onClick={handleTogglePause}
            disabled={isPausing}
            className="gap-1.5 text-xs"
          >
            {isPausing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isPaused ? (
              <PlayCircle className="h-3.5 w-3.5" />
            ) : (
              <PauseCircle className="h-3.5 w-3.5" />
            )}
            {isPaused ? 'Reactivar' : 'Pausar 2h'}
          </Button>
        </div>

        {/* Check Results */}
        {checkResults && (
          <div className="space-y-3 mt-2">
            <Separator />
            <p className="text-xs font-medium">Resultado del Chequeo:</p>

            {/* Post-cron decision */}
            <DecisionCard
              label="Cron Diario"
              decision={checkResults.postCron}
              onExecute={() => handleExecuteSync(checkResults.postCron)}
              isExecuting={isExecuting}
            />

            {/* Failed items decision */}
            <DecisionCard
              label="Asuntos Fallidos"
              decision={checkResults.failedItems}
              onExecute={() => handleExecuteSync(checkResults.failedItems)}
              isExecuting={isExecuting}
            />

            {/* Provider health */}
            {checkResults.providerHealth.length > 0 && (
              <div className="text-xs space-y-1">
                <span className="font-medium">Salud de Proveedores:</span>
                {checkResults.providerHealth.map((p) => (
                  <div key={p.provider} className="flex items-center gap-2 ml-2">
                    <span className={`w-2 h-2 rounded-full ${p.severe ? 'bg-red-500' : 'bg-green-500'}`} />
                    <span>{p.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sync Progress */}
        {syncProgress && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            Sincronizando: {syncProgress.done}/{syncProgress.total}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionCard({
  label,
  decision,
  onExecute,
  isExecuting,
}: {
  label: string;
  decision: SyncDecision;
  onExecute: () => void;
  isExecuting: boolean;
}) {
  const urgencyColor: Record<string, string> = {
    low: 'text-muted-foreground',
    medium: 'text-amber-600',
    high: 'text-orange-600',
    critical: 'text-red-600',
  };

  return (
    <div className="border rounded-md p-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <Badge variant={decision.should_sync ? 'destructive' : 'outline'} className="text-[10px]">
          {decision.should_sync ? 'SYNC NECESARIO' : 'OK'}
        </Badge>
      </div>
      <p className={`text-xs ${urgencyColor[decision.urgency] || 'text-muted-foreground'}`}>
        {decision.reason}
      </p>
      {decision.should_sync && (
        <div className="flex items-center gap-2 mt-1">
          <span className="text-muted-foreground">
            {decision.target_items.length > 0
              ? `${decision.target_items.length} asuntos`
              : 'Todos los elegibles'}
          </span>
          <Button
            variant="default"
            size="sm"
            onClick={onExecute}
            disabled={isExecuting}
            className="h-6 text-[10px] gap-1"
          >
            {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
            Ejecutar
          </Button>
        </div>
      )}
    </div>
  );
}
