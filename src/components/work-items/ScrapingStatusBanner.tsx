/**
 * ScrapingStatusBanner - Shows when a work item has a scraping job in progress
 * 
 * Displays a visual indicator when scrape_status = 'IN_PROGRESS' with
 * information about the scraping provider and elapsed time.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, Server } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { WorkItem } from "@/types/work-item";

// Use WorkItem directly - these fields are already optional
interface ScrapingStatusBannerProps {
  workItem: WorkItem & {
    scrape_provider?: string | null;
    scrape_job_id?: string | null;
    scrape_poll_url?: string | null;
    last_scrape_initiated_at?: string | null;
  };
  onRetrySync?: () => void;
  isRetrying?: boolean;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  cpnu: "Rama Judicial (CPNU)",
  samai: "SAMAI",
  "tutelas-api": "Tutelas",
  publicaciones: "Publicaciones Procesales",
};

export function ScrapingStatusBanner({ 
  workItem, 
  onRetrySync, 
  isRetrying 
}: ScrapingStatusBannerProps) {
  // Only show if scraping is in progress
  if (workItem.scrape_status !== 'IN_PROGRESS') {
    return null;
  }

  const providerName = PROVIDER_DISPLAY_NAMES[workItem.scrape_provider || ''] || 
    workItem.scrape_provider?.toUpperCase() || 
    'Proveedor externo';

  const initiatedAt = workItem.last_scrape_initiated_at 
    ? new Date(workItem.last_scrape_initiated_at)
    : null;

  const elapsedTime = initiatedAt
    ? formatDistanceToNow(initiatedAt, { addSuffix: false, locale: es })
    : null;

  return (
    <Alert className="mb-4 border-warning/50 bg-warning/10">
      <Clock className="h-4 w-4 text-warning" />
      <AlertTitle className="text-warning flex items-center gap-2">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Scraping en progreso
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Server className="h-3 w-3" />
            <span>{providerName} está buscando este proceso.</span>
          </div>
          
          {elapsedTime && (
            <span className="text-xs text-muted-foreground/70">
              Iniciado hace {elapsedTime}
            </span>
          )}
          
          <p className="text-sm mt-1">
            Por favor intenta sincronizar nuevamente en <strong>30-60 segundos</strong>.
          </p>
          
          {onRetrySync && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onRetrySync}
              disabled={isRetrying}
              className="w-fit mt-2"
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
                  Reintentando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3 mr-2" />
                  Reintentar sincronización
                </>
              )}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
