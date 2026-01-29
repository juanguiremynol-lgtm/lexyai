/**
 * Sync Status Badge
 * Displays the sync status of a work item
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

interface SyncStatusBadgeProps {
  lastSyncedAt: string | null;
  monitoringEnabled?: boolean;
  scrapeStatus?: string;
  className?: string;
}

export function SyncStatusBadge({
  lastSyncedAt,
  monitoringEnabled = true,
  scrapeStatus,
  className
}: SyncStatusBadgeProps) {
  // Sync disabled
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

  // Currently syncing
  if (scrapeStatus === 'IN_PROGRESS') {
    return (
      <Badge variant="outline" className={cn("gap-1 animate-pulse", className)}>
        <RefreshCw className="h-3 w-3 animate-spin" />
        <span className="hidden sm:inline">Sincronizando...</span>
      </Badge>
    );
  }

  // Never synced
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

  // Stale sync (>24 hours)
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
          <TooltipContent>
            <p className="font-medium">Sincronización desactualizada</p>
            <p className="text-xs text-muted-foreground">
              Última sync: {lastSync.toLocaleString('es-CO')}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Recent sync
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
        <TooltipContent>
          <p className="font-medium">Sincronizado</p>
          <p className="text-xs text-muted-foreground">
            {lastSync.toLocaleString('es-CO')}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
