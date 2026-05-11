/**
 * Sync Status Badge
 * Displays the sync status of a work item.
 * When a `sync` map (from the Andromeda Read API) is provided, renders a
 * multi-source breakdown (CPNU / PP / SAMAI / SAMAI_ESTADOS).
 * Falls back to the legacy single-source view when only `lastSyncedAt` is known.
 */

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from '@/components/ui/tooltip';
import { RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { AndromedaSyncMap, AndromedaSyncEntry } from '@/hooks/useAndromedaRadicado';

interface SyncStatusBadgeProps {
  workItemId?: string;
  lastSyncedAt: string | null;
  monitoringEnabled?: boolean;
  scrapeStatus?: string;
  className?: string;
  showProviderDetails?: boolean;
  sync?: AndromedaSyncMap | null;
}

const SOURCE_LABELS: Record<keyof AndromedaSyncMap, string> = {
  cpnu: 'CPNU',
  pp: 'PP',
  samai: 'SAMAI',
  samai_estados: 'SAMAI Estados',
};

function pickPrimarySync(sync: AndromedaSyncMap): { key: string; entry: AndromedaSyncEntry } | null {
  const order: (keyof AndromedaSyncMap)[] = ['cpnu', 'samai', 'pp', 'samai_estados'];
  // Prefer any entry with a non-null status, in priority order.
  for (const k of order) {
    const e = sync[k];
    if (e && e.status) return { key: k, entry: e };
  }
  return null;
}

export function SyncStatusBadge({
  lastSyncedAt,
  monitoringEnabled = true,
  scrapeStatus,
  className,
  sync,
}: SyncStatusBadgeProps) {
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

  // ─── New multi-source rendering when `sync` is provided ────────────────
  if (sync) {
    const entries = (Object.entries(sync) as [keyof AndromedaSyncMap, AndromedaSyncEntry | undefined][])
      .filter(([, e]) => !!e);
    const statuses = entries
      .map(([, e]) => (e?.status || '').toUpperCase())
      .filter(Boolean);
    const hasError = statuses.some((s) => s === 'ERROR' || s === 'FAILED');
    const allSuccess = statuses.length > 0 && statuses.every((s) => s === 'SUCCESS');
    const allNull = statuses.length === 0;

    const primary = pickPrimarySync(sync);
    const lastSyncIso =
      primary?.entry.last_sync_at ??
      entries
        .map(([, e]) => e?.last_sync_at)
        .filter((d): d is string => !!d)
        .sort()
        .pop() ??
      null;
    const hoursSince = lastSyncIso
      ? (Date.now() - new Date(lastSyncIso).getTime()) / (1000 * 60 * 60)
      : Number.POSITIVE_INFINITY;

    let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'outline';
    let Icon: typeof CheckCircle = Clock;
    if (hasError) {
      variant = 'destructive';
      Icon = AlertTriangle;
    } else if (allSuccess && hoursSince <= 24) {
      variant = 'default';
      Icon = CheckCircle;
    } else if (!allNull && hoursSince > 24) {
      variant = 'secondary';
      Icon = AlertTriangle;
    }

    const label = lastSyncIso
      ? formatDistanceToNow(new Date(lastSyncIso), { addSuffix: true, locale: es })
      : 'Sin sync';

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={variant} className={cn('gap-1', className)}>
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{label}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium mb-1">Estado de sincronización</p>
            <div className="space-y-1">
              {entries.map(([k, e]) => {
                if (!e) return null;
                const last = e.last_sync_at
                  ? formatDistanceToNow(new Date(e.last_sync_at), { addSuffix: true, locale: es })
                  : '—';
                return (
                  <div key={k} className="text-xs flex flex-wrap items-center gap-1">
                    <span className="font-medium">{SOURCE_LABELS[k]}:</span>
                    <span className={cn(
                      (e.status || '').toUpperCase() === 'ERROR' && 'text-destructive',
                      (e.status || '').toUpperCase() === 'SUCCESS' && 'text-primary',
                    )}>{e.status ?? 'N/A'}</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{e.total_actuaciones ?? 0} acts</span>
                    {(e.novedades_pendientes ?? 0) > 0 && (
                      <>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-amber-600">{e.novedades_pendientes} pendientes</span>
                      </>
                    )}
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{last}</span>
                  </div>
                );
              })}
            </div>
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

  const tooltipDetails = (
    <>
      <p className="font-medium">
        {hoursSinceSync > 24 ? 'Sincronización desactualizada' : 'Sincronizado'}
      </p>
      <p className="text-xs text-muted-foreground">
        Última sync: {lastSync.toLocaleString('es-CO')}
      </p>
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
