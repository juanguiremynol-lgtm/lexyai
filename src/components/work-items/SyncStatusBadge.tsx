/**
 * Sync Status Badge
 * Displays the sync status of a work item with provider details from external_sync_runs
 */

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from '@/components/ui/tooltip';
import { RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle, Database } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface SyncStatusBadgeProps {
  workItemId?: string;
  lastSyncedAt: string | null;
  monitoringEnabled?: boolean;
  scrapeStatus?: string;
  className?: string;
  showProviderDetails?: boolean;
}

interface ProviderAttempt {
  provider: string;
  data_kind: string;
  status: string;
  latency_ms?: number;
  inserted_count?: number;
}

export function SyncStatusBadge({
  workItemId,
  lastSyncedAt,
  monitoringEnabled = true,
  scrapeStatus,
  className,
  showProviderDetails = false,
}: SyncStatusBadgeProps) {
  const { data: latestRun } = useQuery({
    queryKey: ['external-sync-run', workItemId],
    queryFn: async () => {
      if (!workItemId) return null;
      const { data } = await supabase
        .from('external_sync_runs')
        .select('status, provider_attempts, duration_ms, started_at, total_inserted_acts, total_inserted_pubs, error_code')
        .eq('work_item_id', workItemId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: showProviderDetails && !!workItemId,
    staleTime: 60_000,
  });

  if (!monitoringEnabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className={cn("gap-1", className)}>
              <XCircle className="h-3 w-3" />
              <span className="hidden sm:inline">Sync desactivado</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            La sincronización automática está desactivada para este proceso
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (scrapeStatus === 'IN_PROGRESS') {
    return (
      <Badge variant="outline" className={cn("gap-1 animate-pulse", className)}>
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span className="hidden sm:inline">Sincronizando...</span>
      </Badge>
    );
  }

  if (!lastSyncedAt) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={cn("gap-1", className)}>
              <Clock className="h-3 w-3" />
              <span className="hidden sm:inline">Pendiente</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            Este proceso aún no ha sido sincronizado con fuentes externas
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const lastSync = new Date(lastSyncedAt);
  const hoursSinceSync = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);

  const providerSummary = latestRun?.provider_attempts
    ? (latestRun.provider_attempts as ProviderAttempt[]).map((a) => (
        `${a.provider}: ${a.status}${a.inserted_count ? ` (+${a.inserted_count})` : ''}`
      )).join(' · ')
    : null;

  const tooltipDetails = (
    <>
      <p className="font-medium">
        {hoursSinceSync > 24 ? 'Sincronización desactualizada' : 'Sincronizado'}
      </p>
      <p className="text-xs text-muted-foreground">
        Última sync: {lastSync.toLocaleString('es-CO')}
      </p>
      {latestRun && (
        <div className="mt-1 space-y-0.5">
          {latestRun.duration_ms != null && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Database className="h-3 w-3" />
              {latestRun.total_inserted_acts || 0} acts, {latestRun.total_inserted_pubs || 0} pubs · {latestRun.duration_ms}ms
            </p>
          )}
          {providerSummary && (
            <p className="text-xs text-muted-foreground">{providerSummary}</p>
          )}
          {latestRun.error_code && (
            <p className="text-xs text-destructive">{latestRun.error_code}</p>
          )}
        </div>
      )}
    </>
  );

  if (hoursSinceSync > 24) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="destructive" className={cn("gap-1", className)}>
              <AlertTriangle className="h-3 w-3" />
              <span className="hidden sm:inline">
                {formatDistanceToNow(lastSync, { addSuffix: false, locale: es })}
              </span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{tooltipDetails}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={hoursSinceSync > 4 ? 'secondary' : 'outline'}
            className={cn("gap-1", className)}
          >
            <CheckCircle className="h-3 w-3 text-primary" />
            <span className="hidden sm:inline">
              {formatDistanceToNow(lastSync, { addSuffix: true, locale: es })}
            </span>
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltipDetails}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
