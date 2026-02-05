/**
 * Estados Tab - Publicaciones Procesales ONLY
 * 
 * CRITICAL: This tab displays ONLY work_item_publicaciones (court notifications)
 * from the Publicaciones Procesales API. These are LEGAL OBLIGATIONS with deadlines.
 * 
 * Actuaciones (clerk registry entries from CPNU/SAMAI) are shown in the separate
 * Actuaciones tab and must NEVER appear here.
 * 
 * Features:
 * - Display publicaciones from Rama Judicial API (work_item_publicaciones table ONLY)
 * - Syncing happens AUTOMATICALLY via useLoginSync and daily cron (no manual buttons)
 * - PROMINENT DISPLAY of deadline dates (fecha_desfijacion → términos_inician)
 * - Source badges for Publicaciones API
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  Scale, 
  Calendar,
  ExternalLink,
  RefreshCw,
  AlertTriangle,
  Info,
  Newspaper,
  FileWarning,
  Clock,
} from "lucide-react";
import { format, formatDistanceToNow, addDays, isWeekend } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { WorkItem } from "@/types/work-item";

interface EstadosTabProps {
  workItem: WorkItem & { _source?: string };
}

// Publicacion type for display - ONLY from work_item_publicaciones
interface PublicacionEstado {
  id: string;
  date: string | null;
  date_raw: string | null;
  description: string;
  type: string | null;
  source: string;
  pdf_url?: string | null;
  created_at: string;
  fecha_fijacion: string | null;
  fecha_desfijacion: string | null;
  despacho: string | null;
}

// Source labels and styling - Publicaciones sources only
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Newspaper }> = {
  PUBLICACIONES_API: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-procesales": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-api": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  DEFAULT: { label: "Sistema", color: "text-muted-foreground bg-muted/50", icon: Newspaper },
};

/**
 * Calculate the next business day after a given date
 * In Colombian legal terms, términos begin the day AFTER fecha_desfijacion
 * Skip weekends (Saturday = 6, Sunday = 0)
 * TODO: Also skip Colombian holidays for 100% accuracy
 */
function calculateNextBusinessDay(dateStr: string): Date {
  const date = new Date(dateStr);
  let nextDay = addDays(date, 1);
  
  // Skip weekends
  while (isWeekend(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }
  
  return nextDay;
}

/**
 * Get descriptive text for days until deadline
 */
function getDaysUntil(targetDate: Date): { text: string; urgency: 'past' | 'today' | 'tomorrow' | 'soon' | 'normal' } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return { text: `Hace ${Math.abs(diffDays)} día${Math.abs(diffDays) !== 1 ? 's' : ''}`, urgency: 'past' };
  if (diffDays === 0) return { text: '¡HOY!', urgency: 'today' };
  if (diffDays === 1) return { text: 'Mañana', urgency: 'tomorrow' };
  if (diffDays <= 3) return { text: `En ${diffDays} días`, urgency: 'soon' };
  return { text: `En ${diffDays} días`, urgency: 'normal' };
}

export function EstadosTab({ workItem }: EstadosTabProps) {
  const queryClient = useQueryClient();
  
  // Check if radicado is valid for Publicaciones sync
  const hasValidRadicado = workItem.radicado && workItem.radicado.replace(/\D/g, "").length === 23;
  
  // PUBLICACIONES ONLY: Fetch ONLY from work_item_publicaciones
  // This tab is exclusively for court notifications (estados/publicaciones procesales)
  // Actuaciones from CPNU/SAMAI are displayed in the separate Actuaciones tab
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["work-item-publicaciones", workItem.id],
    queryFn: async () => {
      // Query ONLY work_item_publicaciones - this tab shows estados/publicaciones ONLY
      // FIX 4.1: Filter out archived records
      // FIX 4.2: Add proper ORDER BY with fallback
      const { data: pubs, error: pubsError } = await supabase
        .from("work_item_publicaciones")
        .select("*")
        .eq("work_item_id", workItem.id)
        .eq("is_archived", false)
        .order("fecha_fijacion", { ascending: false, nullsFirst: false });
      
      if (pubsError) throw pubsError;
      
      // Map work_item_publicaciones to display format
      // CRITICAL: Read deadline fields from DB columns (not just raw_data)
      const estadosList: PublicacionEstado[] = (pubs || []).map((pub: any) => ({
        id: pub.id,
        date: pub.published_at,
        date_raw: pub.published_at,
        description: pub.title + (pub.annotation ? ` - ${pub.annotation}` : ''),
        type: pub.tipo_publicacion || 'ESTADO',
        source: pub.source || "PUBLICACIONES_API",
        pdf_url: pub.pdf_url,
        created_at: pub.created_at,
        // CRITICAL: Use DB columns as primary source
        fecha_fijacion: pub.fecha_fijacion || pub.raw_data?.fecha_fijacion || null,
        fecha_desfijacion: pub.fecha_desfijacion || pub.raw_data?.fecha_desfijacion || null,
        despacho: pub.despacho || pub.raw_data?.despacho || null,
      }));
      
      return estadosList;
    },
    enabled: !!workItem.id,
  });

  // NOTE: Manual sync buttons removed - syncing happens automatically via useLoginSync + daily cron
  // The syncPublicacionesMutation was removed as part of the automatic-sync architecture

  const getSourceConfig = (source: string) => {
    return SOURCE_CONFIG[source] || SOURCE_CONFIG.DEFAULT;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header - REMOVED: "Buscar Estados" button - syncing happens automatically */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Estados y Publicaciones Procesales
                <Badge variant="secondary" className="ml-2">
                  {estados?.length || 0} registros
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Estados electrónicos y publicaciones procesales de la Rama Judicial.
                <span className="font-medium text-foreground/80"> Los términos legales inician el día hábil siguiente a la fecha de desfijación.</span>
                <span className="block text-xs mt-1 text-muted-foreground">
                  Los estados se sincronizan automáticamente al iniciar sesión y cada día a las 7:00 AM.
                </span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {!hasValidRadicado && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <FileWarning className="h-3 w-3 mr-1" />
                  Requiere radicado
                </Badge>
              )}
              
              {/* Local refresh button only - just re-queries the database */}
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => refetch()}
                disabled={isFetching}
                title="Refrescar datos locales"
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Empty state - REMOVED: "Buscar Estados" button */}
      {!estados || estados.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <Newspaper className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <div>
                <h3 className="font-semibold mb-2">Sin estados registrados</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  {hasValidRadicado
                    ? "No se han encontrado estados para este proceso aún. Los estados se sincronizan automáticamente al iniciar sesión y cada día a las 7:00 AM."
                    : "Este proceso necesita un radicado válido (23 dígitos) para buscar estados."
                  }
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Estados Timeline */
        <div className="space-y-3">
          {estados.map((estado) => {
            const sourceConfig = getSourceConfig(estado.source);
            const SourceIcon = sourceConfig.icon;
            
            // CRITICAL: Extract deadline info from estado
            const fechaDesfijacion = estado.fecha_desfijacion;
            const hasDeadline = !!fechaDesfijacion;
            const terminosInician = hasDeadline ? calculateNextBusinessDay(fechaDesfijacion) : null;
            const daysInfo = terminosInician ? getDaysUntil(terminosInician) : null;

            return (
              <Card 
                key={estado.id} 
                className={cn(
                  "transition-all hover:shadow-md",
                  hasDeadline && "border-l-4 border-l-amber-500"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left side: Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Tags row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Source badge */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn("text-xs gap-1", sourceConfig.color)}>
                                <SourceIcon className="h-3 w-3" />
                                {sourceConfig.label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Fuente: {estado.source}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        {/* Type badge */}
                        {estado.type && estado.type !== 'ESTADO' && (
                          <Badge variant="secondary" className="text-xs">
                            {estado.type}
                          </Badge>
                        )}
                        
                        {/* PDF link */}
                        {estado.pdf_url && (
                          <a 
                            href={estado.pdf_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Ver PDF
                          </a>
                        )}
                        
                        {/* Warning if no fecha_desfijacion */}
                        {!fechaDesfijacion && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Sin fecha de desfijación
                          </Badge>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-sm leading-relaxed">
                        {estado.description}
                      </p>

                      {/* PROMINENT DEADLINE SECTION */}
                      {hasDeadline && terminosInician && daysInfo && (
                        <div className={cn(
                          "mt-2 p-3 rounded-lg border flex items-center justify-between gap-4",
                          daysInfo.urgency === 'past' && "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
                          daysInfo.urgency === 'today' && "bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-700",
                          daysInfo.urgency === 'tomorrow' && "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800",
                          daysInfo.urgency === 'soon' && "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
                          daysInfo.urgency === 'normal' && "bg-slate-50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-700"
                        )}>
                          <div className="flex items-center gap-3">
                            <Clock className={cn(
                              "h-5 w-5 flex-shrink-0",
                              daysInfo.urgency === 'past' && "text-red-600",
                              daysInfo.urgency === 'today' && "text-red-700",
                              daysInfo.urgency === 'tomorrow' && "text-orange-600",
                              daysInfo.urgency === 'soon' && "text-amber-600",
                              daysInfo.urgency === 'normal' && "text-slate-500"
                            )} />
                            <div>
                              <p className={cn(
                                "text-sm font-medium",
                                daysInfo.urgency === 'past' && "text-red-700 dark:text-red-400",
                                daysInfo.urgency === 'today' && "text-red-800 dark:text-red-300",
                                daysInfo.urgency === 'tomorrow' && "text-orange-700 dark:text-orange-400",
                                daysInfo.urgency === 'soon' && "text-amber-700 dark:text-amber-400",
                                daysInfo.urgency === 'normal' && "text-slate-700 dark:text-slate-300"
                              )}>
                                ⚠️ Términos inician: <span className="font-bold">{format(terminosInician, "d 'de' MMMM yyyy", { locale: es })}</span>
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Desfijación: {format(new Date(fechaDesfijacion), "d MMM yyyy", { locale: es })}
                                {estado.despacho && (
                                  <> • {estado.despacho}</>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className={cn(
                            "text-sm font-semibold px-3 py-1 rounded-full",
                            daysInfo.urgency === 'past' && "bg-red-200 text-red-800 dark:bg-red-800 dark:text-red-200",
                            daysInfo.urgency === 'today' && "bg-red-300 text-red-900 dark:bg-red-700 dark:text-red-100",
                            daysInfo.urgency === 'tomorrow' && "bg-orange-200 text-orange-800 dark:bg-orange-800 dark:text-orange-200",
                            daysInfo.urgency === 'soon' && "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200",
                            daysInfo.urgency === 'normal' && "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          )}>
                            {daysInfo.text}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right side: Date */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {estado.date ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {format(new Date(estado.date), "d MMM yyyy", { locale: es })}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(estado.date), { addSuffix: true, locale: es })}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sin fecha</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Info footer */}
      {estados && estados.length > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-primary mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <strong>⚠️ Términos Legales:</strong> Los términos procesales inician el <strong>día hábil siguiente</strong> a 
                  la fecha de desfijación del estado. Revisa las fechas destacadas en cada publicación.
                </p>
                <p className="text-xs">
                  <strong>Nota:</strong> Las actuaciones del expediente (entradas del libro del juzgado) se muestran en la pestaña "Actuaciones".
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
