/**
 * Estados Tab - UNIFIED view for court notifications and actuaciones
 * 
 * ONLY for CGP, CPACA, TUTELA, and LABORAL workflows
 * 
 * Features:
 * - Display imported estados from ICARUS/scrapers (work_item_acts table)
 * - Display publicaciones from Rama Judicial API (work_item_publicaciones table)
 * - MERGED view with source badges (ICARUS, CPNU, Rama Judicial, etc.)
 * - Single sync button that triggers Publicaciones sync
 * - Show suggested stage with confidence indicator
 * - Allow user to apply/override suggested stage
 * - Track milestone detection
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  Scale, 
  Calendar,
  FileText,
  ExternalLink,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  ArrowRight,
  Check,
  X,
  Loader2,
  Lightbulb,
  Newspaper,
  FileWarning,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { applyManualStageUpdate } from "@/lib/ingestion/estados-ingestion-service";
import { getStageLabelForInference, type StageConfidence } from "@/lib/workflows/estado-stage-inference";
import type { WorkItem } from "@/types/work-item";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

interface EstadosTabProps {
  workItem: WorkItem & { _source?: string };
}

// Unified item type for merged display
interface UnifiedEstado {
  id: string;
  date: string | null;
  date_raw: string | null;
  description: string;
  type: string | null;
  source: string;
  source_reference: string | null;
  pdf_url?: string | null;
  is_publicacion: boolean; // true if from work_item_publicaciones
  milestone_type: string | null;
  triggers_phase_change: boolean;
  created_at: string;
  raw_data: {
    inference_result?: {
      suggestedStage: string | null;
      suggestedCgpPhase: string | null;
      confidence: StageConfidence;
      category: string;
      reasoning: string;
      auto_applied: boolean;
    };
    fecha_fijacion?: string;
    fecha_desfijacion?: string;
    tipo_publicacion?: string;
    despacho?: string;
    [key: string]: unknown;
  } | null;
}

// Source labels and styling - ENHANCED with Publicaciones sources
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Database }> = {
  ICARUS_ESTADOS: { label: "ICARUS", color: "text-blue-600 bg-blue-500/10", icon: FileText },
  ICARUS_ESTADOS_EXCEL: { label: "ICARUS", color: "text-blue-600 bg-blue-500/10", icon: FileText },
  SCRAPER: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: RefreshCw },
  CPNU: { label: "CPNU", color: "text-purple-600 bg-purple-500/10", icon: Database },
  MANUAL: { label: "Manual", color: "text-amber-600 bg-amber-500/10", icon: FileText },
  DEFAULT: { label: "Sistema", color: "text-muted-foreground bg-muted/50", icon: Database },
  // Publicaciones sources
  PUBLICACIONES_API: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-procesales": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
  "publicaciones-api": { label: "Publicaciones", color: "text-emerald-600 bg-emerald-500/10", icon: Newspaper },
};

// Milestone type styling
const MILESTONE_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  AUTO_ADMISORIO: { label: "Auto Admisorio", color: "text-emerald-600", icon: CheckCircle2 },
  INADMISION: { label: "Inadmisión", color: "text-amber-600", icon: AlertTriangle },
  RECHAZO: { label: "Rechazo", color: "text-red-600", icon: X },
  REQUERIMIENTO: { label: "Requerimiento", color: "text-orange-600", icon: AlertTriangle },
  AUDIENCIA_PROGRAMADA: { label: "Audiencia Programada", color: "text-purple-600", icon: Calendar },
  AUDIENCIA_INICIAL: { label: "Audiencia Inicial", color: "text-purple-600", icon: Calendar },
  AUDIENCIA_INSTRUCCION: { label: "Audiencia Instrucción", color: "text-purple-600", icon: Calendar },
  AUDIENCIA_CELEBRADA: { label: "Audiencia Celebrada", color: "text-purple-600", icon: CheckCircle2 },
  SENTENCIA: { label: "Sentencia", color: "text-blue-600", icon: Scale },
  FALLO_PRIMERA_INSTANCIA: { label: "Fallo 1ª Instancia", color: "text-blue-600", icon: Scale },
  FALLO_SEGUNDA_INSTANCIA: { label: "Fallo 2ª Instancia", color: "text-blue-600", icon: Scale },
  NOTIFICACION: { label: "Notificación", color: "text-cyan-600", icon: Info },
  NOTIFICACION_PERSONAL: { label: "Notificación Personal", color: "text-cyan-600", icon: Info },
  NOTIFICACION_AVISO: { label: "Notificación por Aviso", color: "text-cyan-600", icon: Info },
  APELACION: { label: "Apelación", color: "text-indigo-600", icon: ArrowRight },
  APELACION_ADMITIDA: { label: "Apelación Admitida", color: "text-indigo-600", icon: CheckCircle2 },
  IMPUGNACION: { label: "Impugnación", color: "text-indigo-600", icon: ArrowRight },
  EMBARGO: { label: "Embargo", color: "text-red-600", icon: AlertTriangle },
  DESACATO: { label: "Desacato", color: "text-red-600", icon: AlertTriangle },
  ARCHIVO: { label: "Archivo", color: "text-slate-600", icon: FileText },
  RADICACION: { label: "Radicación", color: "text-green-600", icon: FileText },
  TRASLADO_DEMANDA: { label: "Traslado Demanda", color: "text-cyan-600", icon: ArrowRight },
  TRASLADO_EXCEPCIONES: { label: "Traslado Excepciones", color: "text-cyan-600", icon: ArrowRight },
  ALEGATOS: { label: "Alegatos", color: "text-purple-600", icon: FileText },
  REFORMA_DEMANDA: { label: "Reforma Demanda", color: "text-amber-600", icon: FileText },
  MANDAMIENTO_PAGO: { label: "Mandamiento de Pago", color: "text-emerald-600", icon: CheckCircle2 },
  CUMPLIMIENTO: { label: "Cumplimiento", color: "text-emerald-600", icon: CheckCircle2 },
};

// Confidence styling
const CONFIDENCE_CONFIG: Record<StageConfidence, { label: string; color: string; bgColor: string }> = {
  HIGH: { label: "Alta", color: "text-emerald-700", bgColor: "bg-emerald-100 dark:bg-emerald-900/30" },
  MEDIUM: { label: "Media", color: "text-amber-700", bgColor: "bg-amber-100 dark:bg-amber-900/30" },
  LOW: { label: "Baja", color: "text-slate-600", bgColor: "bg-slate-100 dark:bg-slate-800/50" },
};

export function EstadosTab({ workItem }: EstadosTabProps) {
  const queryClient = useQueryClient();
  const [applyingStageFor, setApplyingStageFor] = useState<string | null>(null);
  const [isSyncingPublicaciones, setIsSyncingPublicaciones] = useState(false);
  
  // Check if radicado is valid for Publicaciones sync
  const hasValidRadicado = workItem.radicado && workItem.radicado.replace(/\D/g, "").length === 23;
  
  // UNIFIED QUERY: Fetch from BOTH work_item_acts AND work_item_publicaciones
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["work-item-estados-unified", workItem.id],
    queryFn: async () => {
      // Fetch from BOTH sources in parallel
      const [actsResult, pubsResult] = await Promise.all([
        supabase
          .from("work_item_acts")
          .select("*")
          .eq("work_item_id", workItem.id)
          .order("act_date", { ascending: false }),
        supabase
          .from("work_item_publicaciones")
          .select("*")
          .eq("work_item_id", workItem.id)
          .order("published_at", { ascending: false }),
      ]);
      
      const acts = actsResult.data || [];
      const pubs = pubsResult.data || [];
      
      // Map work_item_acts to unified format
      const unifiedActs: UnifiedEstado[] = acts.map((act: any) => ({
        id: act.id,
        date: act.act_date,
        date_raw: act.act_date_raw,
        description: act.description,
        type: act.act_type,
        source: act.source || "DEFAULT",
        source_reference: act.source_reference,
        pdf_url: null,
        is_publicacion: false,
        milestone_type: act.act_type || null,
        triggers_phase_change: false,
        created_at: act.created_at,
        raw_data: act.raw_data,
      }));
      
      // Map work_item_publicaciones to unified format
      const unifiedPubs: UnifiedEstado[] = pubs.map((pub: any) => ({
        id: pub.id,
        date: pub.published_at,
        date_raw: pub.published_at,
        description: pub.title + (pub.annotation ? ` - ${pub.annotation}` : ''),
        type: pub.raw_data?.tipo_publicacion || 'ESTADO',
        source: pub.source || "PUBLICACIONES_API",
        source_reference: null,
        pdf_url: pub.pdf_url,
        is_publicacion: true,
        milestone_type: null,
        triggers_phase_change: false,
        created_at: pub.created_at,
        raw_data: {
          fecha_fijacion: pub.raw_data?.fecha_fijacion,
          fecha_desfijacion: pub.raw_data?.fecha_desfijacion,
          tipo_publicacion: pub.raw_data?.tipo_publicacion,
          despacho: pub.raw_data?.despacho,
          ...(pub.raw_data || {}),
        },
      }));
      
      // Merge and sort by date descending
      const unified = [...unifiedActs, ...unifiedPubs];
      unified.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
      
      // If no data from new tables, try legacy fallback
      if (unified.length === 0) {
        const legacyFilingId = workItem.legacy_filing_id;
        const legacyProcessId = workItem.legacy_process_id;
        
        if (legacyFilingId || legacyProcessId) {
          let query = supabase
            .from("actuaciones")
            .select("*")
            .order("act_date", { ascending: false });
          
          if (legacyFilingId) {
            query = query.eq("filing_id", legacyFilingId);
          } else if (legacyProcessId) {
            query = query.eq("monitored_process_id", legacyProcessId);
          }
          
          const { data: legacyActs } = await query;
          
          if (legacyActs) {
            return legacyActs.map((act: any) => ({
              id: act.id,
              date: act.act_date,
              date_raw: act.act_date_raw,
              description: act.normalized_text || act.raw_text,
              type: act.act_type_guess,
              source: act.adapter_name || "LEGACY",
              source_reference: act.source_url,
              pdf_url: null,
              is_publicacion: false,
              milestone_type: null,
              triggers_phase_change: false,
              created_at: act.created_at,
              raw_data: null,
            })) as UnifiedEstado[];
          }
        }
      }
      
      return unified;
    },
    enabled: !!workItem.id,
  });
  
  // Sync Publicaciones mutation
  const syncPublicacionesMutation = useMutation({
    mutationFn: async () => {
      setIsSyncingPublicaciones(true);
      const { data, error } = await supabase.functions.invoke("sync-publicaciones-by-work-item", {
        body: { work_item_id: workItem.id },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      setIsSyncingPublicaciones(false);
      queryClient.invalidateQueries({ queryKey: ["work-item-estados-unified", workItem.id] });
      queryClient.invalidateQueries({ queryKey: ["work-item-publicaciones", workItem.id] });
      
      if (result.ok) {
        if (result.inserted_count > 0) {
          toast.success(`${result.inserted_count} nuevos estados encontrados`);
        } else {
          toast.info("No hay nuevos estados");
        }
      } else if (result.scraping_initiated) {
        toast.info("Búsqueda iniciada. Reintente en 30-60 segundos.", {
          description: `Job ID: ${result.scraping_job_id}`,
        });
      } else {
        toast.error(result.errors?.[0] || "Error al sincronizar");
      }
    },
    onError: (err) => {
      setIsSyncingPublicaciones(false);
      console.error("Publicaciones sync error:", err);
      toast.error(err instanceof Error ? err.message : "Error al sincronizar");
    },
  });

  // Mutation for applying stage
  const applyMutation = useMutation({
    mutationFn: async ({ 
      estadoId,
      suggestedStage, 
      suggestedCgpPhase 
    }: { 
      estadoId: string;
      suggestedStage: string; 
      suggestedCgpPhase: string | null;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No autenticado");
      
      const result = await applyManualStageUpdate(
        workItem.id,
        suggestedStage,
        suggestedCgpPhase as CGPPhase | null,
        user.id,
        estadoId
      );
      
      if (!result.success) {
        throw new Error(result.error);
      }
      
      return { suggestedStage };
    },
    onSuccess: ({ suggestedStage }) => {
      toast.success(`Etapa actualizada a: ${getStageLabelForInference(
        workItem.workflow_type as WorkflowType,
        suggestedStage,
        workItem.cgp_phase as CGPPhase | null
      )}`);
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["work-item-detail", workItem.id] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["cpaca-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["tutelas-pipeline"] });
      
      setApplyingStageFor(null);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
      setApplyingStageFor(null);
    },
  });

  const handleApplyStage = (estado: UnifiedEstado) => {
    const inference = estado.raw_data?.inference_result;
    if (!inference?.suggestedStage) return;
    
    setApplyingStageFor(estado.id);
    applyMutation.mutate({
      estadoId: estado.id,
      suggestedStage: inference.suggestedStage,
      suggestedCgpPhase: inference.suggestedCgpPhase,
    });
  };

  const getSourceConfig = (source: string) => {
    return SOURCE_CONFIG[source] || SOURCE_CONFIG.DEFAULT;
  };

  const getMilestoneConfig = (milestoneType: string | null) => {
    if (!milestoneType) return null;
    return MILESTONE_CONFIG[milestoneType] || null;
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
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Estados y Publicaciones
                <Badge variant="secondary" className="ml-2">
                  {estados?.length || 0} registros
                </Badge>
              </CardTitle>
              <CardDescription className="mt-1">
                Estados electrónicos y publicaciones procesales de la Rama Judicial
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {!hasValidRadicado && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <FileWarning className="h-3 w-3 mr-1" />
                  Requiere radicado
                </Badge>
              )}
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => syncPublicacionesMutation.mutate()}
                disabled={!hasValidRadicado || isSyncingPublicaciones}
              >
                <Newspaper className={cn("h-4 w-4 mr-2", isSyncingPublicaciones && "animate-spin")} />
                {isSyncingPublicaciones ? "Sincronizando..." : "Buscar Estados"}
              </Button>
              
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Historial de actuaciones importadas desde ICARUS, sincronizadas desde CPNU, o estados electrónicos de la Rama Judicial.
            Los estados marcan el inicio de términos procesales (el día siguiente a la fecha de desfijación).
          </p>
        </CardContent>
      </Card>

      {/* Empty state */}
      {!estados || estados.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center space-y-3">
              <Scale className="h-12 w-12 mx-auto text-muted-foreground/50" />
              <div>
                <h3 className="font-semibold mb-2">Sin estados registrados</h3>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  {hasValidRadicado
                    ? "No se han encontrado estados para este proceso. Haz clic en \"Buscar Estados\" para sincronizar desde la Rama Judicial."
                    : "Este proceso necesita un radicado válido (23 dígitos) para buscar estados. También puedes importar estados desde un archivo Excel de ICARUS."
                  }
                </p>
              </div>
              {hasValidRadicado && (
                <Button 
                  onClick={() => syncPublicacionesMutation.mutate()}
                  disabled={isSyncingPublicaciones}
                  size="sm"
                >
                  <Newspaper className={cn("h-4 w-4 mr-2", isSyncingPublicaciones && "animate-spin")} />
                  {isSyncingPublicaciones ? "Buscando..." : "Buscar Estados"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Estados Timeline */
        <div className="space-y-3">
          {estados.map((estado) => {
            const sourceConfig = getSourceConfig(estado.source);
            const milestoneConfig = getMilestoneConfig(estado.milestone_type);
            const SourceIcon = sourceConfig.icon;
            const inference = estado.raw_data?.inference_result;
            const hasSuggestion = inference?.suggestedStage && !inference.auto_applied;
            const wasAutoApplied = inference?.auto_applied;
            const confidenceConfig = inference?.confidence ? CONFIDENCE_CONFIG[inference.confidence] : null;
            const isApplying = applyingStageFor === estado.id;

            return (
              <Card 
                key={estado.id} 
                className={cn(
                  "transition-all hover:shadow-md",
                  wasAutoApplied && "border-emerald-500/50 bg-emerald-50/30 dark:bg-emerald-950/20",
                  hasSuggestion && "border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/10",
                  milestoneConfig && !wasAutoApplied && !hasSuggestion && "border-l-4 border-l-primary"
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

                        {/* Milestone badge */}
                        {milestoneConfig && (
                          <Badge className={cn("text-xs gap-1", milestoneConfig.color, "bg-transparent border")}>
                            <milestoneConfig.icon className="h-3 w-3" />
                            {milestoneConfig.label}
                          </Badge>
                        )}

                        {/* Auto-applied indicator */}
                        {wasAutoApplied && inference?.suggestedStage && (
                          <Badge className="text-xs bg-emerald-500 text-white gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Etapa aplicada: {getStageLabelForInference(
                              workItem.workflow_type as WorkflowType,
                              inference.suggestedStage,
                              inference.suggestedCgpPhase as CGPPhase | null
                            )}
                          </Badge>
                        )}

                        {/* Act type (if no milestone) */}
                        {estado.type && !milestoneConfig && estado.type !== 'ESTADO' && (
                          <Badge variant="secondary" className="text-xs">
                            {estado.type}
                          </Badge>
                        )}
                        
                        {/* PDF link for publicaciones */}
                        {estado.is_publicacion && estado.pdf_url && (
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
                      </div>

                      {/* Description */}
                      <p className="text-sm leading-relaxed">
                        {estado.description}
                      </p>

                      {/* Stage suggestion (if not auto-applied) */}
                      {hasSuggestion && confidenceConfig && (
                        <div className={cn(
                          "flex items-center gap-3 p-3 rounded-lg mt-2",
                          confidenceConfig.bgColor
                        )}>
                          <Lightbulb className={cn("h-5 w-5 flex-shrink-0", confidenceConfig.color)} />
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-medium", confidenceConfig.color)}>
                              Sugerencia: {getStageLabelForInference(
                                workItem.workflow_type as WorkflowType,
                                inference.suggestedStage!,
                                inference.suggestedCgpPhase as CGPPhase | null
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Confianza {confidenceConfig.label.toLowerCase()} — {inference.reasoning}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="gap-1"
                                    onClick={() => handleApplyStage(estado)}
                                    disabled={isApplying}
                                  >
                                    {isApplying ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Check className="h-3 w-3" />
                                    )}
                                    Aplicar
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Actualizar etapa del proceso a esta sugerencia</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      )}

                      {/* Raw date if different */}
                      {estado.date_raw && estado.date_raw !== estado.date && (
                        <p className="text-xs text-muted-foreground italic">
                          Fecha original: {estado.date_raw}
                        </p>
                      )}
                      
                      {/* Publicacion-specific: fecha fijacion/desfijacion */}
                      {estado.is_publicacion && estado.raw_data?.fecha_desfijacion && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Términos inician:</span>{" "}
                          {estado.raw_data.fecha_desfijacion} (día siguiente a desfijación)
                        </p>
                      )}
                    </div>

                    {/* Right side: Date and actions */}
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

                      {estado.source_reference && estado.source_reference.startsWith('http') && (
                        <a
                          href={estado.source_reference}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline text-xs flex items-center gap-1 mt-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ver fuente
                        </a>
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
              <Sparkles className="h-4 w-4 text-primary mt-0.5" />
              <div className="text-sm text-muted-foreground">
                <p>
                  <strong>Inferencia Inteligente:</strong> ATENIA analiza cada estado y sugiere 
                  la etapa del proceso. Las sugerencias con <strong>alta confianza</strong> se 
                  aplican automáticamente. Las de <strong>media/baja confianza</strong> requieren 
                  tu aprobación. Siempre puedes reclasificar manualmente.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
