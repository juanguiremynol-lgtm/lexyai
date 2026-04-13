/**
 * Estados Tab - Court Notifications & ESTADOS
 * 
 * This tab displays ESTADOS data from two canonical sources:
 *   1. work_item_publicaciones — Publicaciones Procesales API (Rama Judicial)
 *   2. work_item_acts WHERE source='SAMAI_ESTADOS' — SAMAI Estados external provider (CPACA)
 * 
 * Actuaciones (clerk registry entries from CPNU/SAMAI actuaciones) are shown in the
 * separate Actuaciones tab and must NEVER appear here.
 * 
 * Features:
 * - Display publicaciones + SAMAI_ESTADOS records merged into a unified timeline
 * - Syncing happens AUTOMATICALLY via useLoginSync and daily cron (no manual buttons)
 * - PROMINENT DISPLAY of deadline dates (fecha_desfijacion → términos_inician)
 * - Source badges showing provenance (Rama Judicial vs SAMAI Estados)
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ensureValidSession } from "@/lib/supabase-query-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { SyncStatusBadge } from "@/components/work-items/SyncStatusBadge";
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
  ShieldAlert,
  ChevronDown,
} from "lucide-react";
import { format, formatDistanceToNow, addDays, isWeekend } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { WorkItem } from "@/types/work-item";
import { ActuacionDiffView } from "@/components/work-items/ActuacionDiffView";

// Coverage gap type
interface CoverageGap {
  id: string;
  provider_key: string;
  data_kind: string;
  workflow: string;
  radicado: string;
  last_seen_at: string;
  occurrences: number;
  last_http_status: number | null;
  last_response_redacted: any;
  status: string;
}

interface EstadosTabProps {
  workItem: WorkItem & { _source?: string };
}

// Publicacion type for display - ONLY from work_item_publicaciones
interface PublicacionEstado {
  id: string;
  hash_fingerprint?: string | null;
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

// Source labels and styling
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Newspaper }> = {
  PUBLICACIONES_API: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-procesales": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-api": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  publicaciones: { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  SAMAI_ESTADOS: { label: "SAMAI Estados", color: "text-blue-600 bg-blue-500/10", icon: Scale },
  samai_estados: { label: "SAMAI Estados", color: "text-blue-600 bg-blue-500/10", icon: Scale },
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
  
  // Fetch ESTADOS from three sources:
  // 1. work_item_publicaciones — Publicaciones Procesales (Rama Judicial)
  // 2. work_item_acts WHERE source='SAMAI_ESTADOS' — directly tagged SAMAI Estados
  // 3. work_item_acts confirmed by SAMAI_ESTADOS provenance (deduped records with source='samai')
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["work-item-estados-unified", workItem.id],
    queryFn: async () => {
      await ensureValidSession();

      // Find the SAMAI_ESTADOS provider instance ID for provenance lookup
      const { data: samaiEstadosInstances } = await supabase
        .from("provider_instances")
        .select("id, connector_id, provider_connectors!inner(key)")
        .eq("provider_connectors.key", "SAMAI_ESTADOS")
        .eq("is_enabled", true);

      const samaiEstadosInstanceIds = (samaiEstadosInstances || []).map((i: any) => i.id);

      // Query publicaciones + direct SAMAI_ESTADOS acts in parallel
      const [pubsResult, samaiEstadosResult, provenanceIdsResult] = await Promise.all([
        supabase
          .from("work_item_publicaciones")
          .select("*")
          .eq("work_item_id", workItem.id)
          .eq("is_archived", false)
          .order("fecha_fijacion", { ascending: false, nullsFirst: false }),
        supabase
          .from("work_item_acts")
          .select("*")
          .eq("work_item_id", workItem.id)
          .eq("source", "SAMAI_ESTADOS")
          .eq("is_archived", false)
          .order("act_date", { ascending: false, nullsFirst: false }),
        // Get act IDs confirmed by SAMAI_ESTADOS provenance (no FK join needed)
        samaiEstadosInstanceIds.length > 0
          ? supabase
              .from("act_provenance")
              .select("work_item_act_id")
              .in("provider_instance_id", samaiEstadosInstanceIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (pubsResult.error) throw pubsResult.error;
      if (samaiEstadosResult.error) throw samaiEstadosResult.error;

      // Step 2: If we have provenance-confirmed act IDs, fetch those acts
      const provenanceActIds = (provenanceIdsResult.data || []).map((r: any) => r.work_item_act_id);
      let provenanceActs: any[] = [];
      if (provenanceActIds.length > 0) {
        const { data } = await supabase
          .from("work_item_acts")
          .select("*")
          .in("id", provenanceActIds)
          .eq("work_item_id", workItem.id)
          .eq("is_archived", false);
        provenanceActs = data || [];
      }

      // Map work_item_publicaciones to display format
      const fromPubs: PublicacionEstado[] = (pubsResult.data || []).map((pub: any) => {
        // Extract pdf_url: direct field → raw_data attachments → raw_data fields
        let pdfUrl = pub.pdf_url || pub.entry_url || null;
        if (!pdfUrl && pub.raw_data) {
          const rd = pub.raw_data;
          // Check attachments array (SAMAI Estados format)
          if (Array.isArray(rd.attachments) && rd.attachments.length > 0) {
            pdfUrl = rd.attachments[0]?.url || null;
          }
          // Check common URL fields in raw_data
          if (!pdfUrl) {
            pdfUrl = rd.pdf_url || rd.url_descarga || rd.documento_url || rd.url || null;
          }
        }
        return {
          id: pub.id,
          hash_fingerprint: pub.hash_fingerprint || null,
          date: pub.published_at,
          date_raw: pub.published_at,
          description: pub.title + (pub.annotation ? ` - ${pub.annotation}` : ''),
          type: pub.tipo_publicacion || 'ESTADO',
          source: pub.source || "PUBLICACIONES_API",
          pdf_url: pdfUrl,
          created_at: pub.created_at,
          fecha_fijacion: pub.fecha_fijacion || pub.raw_data?.fecha_fijacion || null,
          fecha_desfijacion: pub.fecha_desfijacion || pub.raw_data?.fecha_desfijacion || null,
          despacho: pub.despacho || pub.raw_data?.despacho || null,
        };
      });

      // Map directly tagged SAMAI_ESTADOS acts
      const samaiDirectIds = new Set<string>();
      const fromSamaiEstados: PublicacionEstado[] = (samaiEstadosResult.data || []).map((act: any) => {
        samaiDirectIds.add(act.id);
        return {
          id: act.id,
          date: act.act_date,
          date_raw: act.act_date,
          description: act.description || act.event_summary || '',
          type: act.act_type || 'ESTADO',
          source: "SAMAI_ESTADOS",
          pdf_url: act.source_url || null,
          created_at: act.created_at,
          fecha_fijacion: null,
          fecha_desfijacion: null,
          despacho: act.despacho || null,
        };
      });

      // Map provenance-confirmed SAMAI_ESTADOS acts (deduped records with source='samai')
      // Only include those NOT already in the direct SAMAI_ESTADOS list
      const fromProvenance: PublicacionEstado[] = [];
      for (const act of provenanceActs) {
        if (samaiDirectIds.has(act.id)) continue;
        samaiDirectIds.add(act.id); // prevent duplicates from multiple provenance rows
        fromProvenance.push({
          id: act.id,
          date: act.act_date,
          date_raw: act.act_date,
          description: act.description || act.event_summary || '',
          type: act.act_type || 'ESTADO',
          source: "SAMAI_ESTADOS", // Tag as SAMAI_ESTADOS since provenance confirms it
          pdf_url: act.source_url || null,
          created_at: act.created_at,
          fecha_fijacion: null,
          fecha_desfijacion: null,
          despacho: act.despacho || null,
        });
      }

      // Merge all sources and sort by date descending
      const merged = [...fromPubs, ...fromSamaiEstados, ...fromProvenance].sort((a, b) => {
        const dateA = a.date || a.created_at;
        const dateB = b.date || b.created_at;
        return dateB.localeCompare(dateA);
      });


      // UI-level dedup: three passes
      // 1) By hash_fingerprint (exact provider dedup)
      // 2) For publicaciones: by title — keep the one with published_at, discard the one without
      // 3) By date + normalised description (content dedup across providers)
      const seen = new Map<string, PublicacionEstado>();
      const contentKeys = new Map<string, PublicacionEstado>();
      const pubTitleKeys = new Map<string, PublicacionEstado>();

      const normalizeDesc = (s: string | null | undefined) =>
        (s || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 50);

      const richness = (item: PublicacionEstado) =>
        (item.fecha_fijacion ? 1 : 0) + (item.pdf_url ? 1 : 0) + (item.description ? 1 : 0) + (item.date ? 1 : 0);

      for (const item of merged) {
        // Pass 1: fingerprint dedup
        const fpKey = item.hash_fingerprint || item.id;
        const existingFp = seen.get(fpKey);
        if (existingFp) {
          if (richness(item) > richness(existingFp)) {
            seen.set(fpKey, item);
          }
          continue;
        }
        seen.set(fpKey, item);

        // Pass 2: publicaciones title dedup — same title + same source='publicaciones'
        if (item.source === 'publicaciones' || item.source === 'Publicaciones') {
          const titleKey = `pub|${normalizeDesc(item.description)}`;
          const existingPub = pubTitleKeys.get(titleKey);
          if (existingPub) {
            // Keep the one with a date; if both have dates, keep richer
            const keepNew = (!existingPub.date && item.date) || (richness(item) > richness(existingPub));
            if (keepNew) {
              seen.delete(existingPub.hash_fingerprint || existingPub.id);
              pubTitleKeys.set(titleKey, item);
            } else {
              seen.delete(fpKey);
            }
            continue;
          }
          pubTitleKeys.set(titleKey, item);
        }

        // Pass 3: content dedup (date + first 50 chars of description)
        const dateStr = item.date || "";
        const desc = normalizeDesc(item.description);
        if (dateStr && desc) {
          const contentKey = `${dateStr}|${desc}`;
          const existingContent = contentKeys.get(contentKey);
          if (existingContent) {
            if (richness(item) > richness(existingContent)) {
              seen.delete(existingContent.hash_fingerprint || existingContent.id);
              contentKeys.set(contentKey, item);
            } else {
              seen.delete(fpKey);
            }
          } else {
            contentKeys.set(contentKey, item);
          }
        }
      }

      return Array.from(seen.values());
    },
    enabled: !!workItem.id,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Query coverage gaps for this work item
  const { data: coverageGaps } = useQuery({
    queryKey: ["work-item-coverage-gaps", workItem.id],
    queryFn: async () => {
      await ensureValidSession();
      const { data, error } = await supabase
        .from("work_item_coverage_gaps" as any)
        .select("*")
        .eq("work_item_id", workItem.id)
        .eq("status", "OPEN");
      if (error) {
        console.warn("Failed to fetch coverage gaps:", error);
        return [];
      }
      return (data || []) as unknown as CoverageGap[];
    },
    enabled: !!workItem.id,
    staleTime: 5 * 60 * 1000,
  });

  const hasCoverageGap = (coverageGaps?.length ?? 0) > 0;
  const estadosGap = coverageGaps?.find(g => g.data_kind === "ESTADOS");

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
      {/* Diff view for recent changes */}
      <ActuacionDiffView workItemId={workItem.id} dataKind="estados" />

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
                <SyncStatusBadge
                  lastSyncedAt={workItem.last_synced_at ?? null}
                  monitoringEnabled={workItem.monitoring_enabled}
                  scrapeStatus={workItem.scrape_status}
                />
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

      {/* Empty state with coverage gap awareness */}
      {!estados || estados.length === 0 ? (
        hasCoverageGap && estadosGap ? (
          /* COVERAGE GAP BANNER — not misleading "sin estados" */
          <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="py-8">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="h-8 w-8 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <h3 className="font-semibold text-foreground">
                      Brecha de cobertura del proveedor
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      No encontramos estados en nuestras fuentes automáticas para este proceso (posible brecha de cobertura del proveedor).
                      Esto significa que el portal electrónico de la Rama Judicial no retorna estados para este radicado,
                      aunque pueden existir en el juzgado físico.
                    </p>
                  </div>
                </div>

                {/* Diagnostic accordion */}
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
                      <ChevronDown className="h-4 w-4" />
                      Ver diagnóstico
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div className="rounded-lg border bg-background p-4 space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                        <div>
                          <span className="text-muted-foreground">Proveedor:</span>
                          <span className="ml-2 font-medium">Publicaciones Procesales</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Resultado:</span>
                          <Badge variant="outline" className="ml-2 text-amber-600 border-amber-300">
                            found=false
                          </Badge>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Último intento:</span>
                          <span className="ml-2">
                            {format(new Date(estadosGap.last_seen_at), "d MMM yyyy HH:mm", { locale: es })}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Intentos totales:</span>
                          <span className="ml-2 font-medium">{estadosGap.occurrences}</span>
                        </div>
                        {estadosGap.last_http_status && (
                          <div>
                            <span className="text-muted-foreground">HTTP Status:</span>
                            <span className="ml-2">{estadosGap.last_http_status}</span>
                          </div>
                        )}
                        {estadosGap.last_response_redacted?.latency_ms && (
                          <div>
                            <span className="text-muted-foreground">Latencia:</span>
                            <span className="ml-2">{estadosGap.last_response_redacted.latency_ms}ms</span>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        El radicado <code className="bg-muted px-1 rounded">{estadosGap.radicado}</code> fue
                        consultado correctamente en el API de Publicaciones Procesales. La respuesta fue vacía
                        (found=false), indicando que este juzgado no publica estados electrónicos en el portal.
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Standard empty state — no coverage gap detected yet */
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
        )
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
                        {estado.pdf_url ? (
                          <a 
                            href={estado.pdf_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Ver PDF
                          </a>
                        ) : estado.description?.toLowerCase().includes('.pdf') && workItem.radicado ? (
                          <a 
                            href={`https://publicacionesprocesales.ramajudicial.gov.co/web/publicaciones-procesales/search?q=${workItem.radicado}&type=com.liferay.document.library.kernel.model.DLFileEntry`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline"
                            title="PDF no disponible directamente — buscar en el portal"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Buscar PDF
                          </a>
                        ) : null}
                        
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
