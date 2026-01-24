/**
 * Estados Tab - Shows imported estados/actuaciones with Stage Inference UI
 * 
 * ONLY for CGP, CPACA, and TUTELA workflows
 * 
 * Features:
 * - Display imported estados from ICARUS/scrapers
 * - Show suggested stage with confidence indicator
 * - Allow user to apply/override suggested stage
 * - Track milestone detection
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface Estado {
  id: string;
  act_date: string | null;
  act_date_raw: string | null;
  description: string;
  act_type: string | null;
  source: string;
  source_reference: string | null;
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
    [key: string]: unknown;
  } | null;
}

// Source labels and styling
const SOURCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Database }> = {
  ICARUS_ESTADOS: { label: "ICARUS", color: "text-blue-600 bg-blue-500/10", icon: FileText },
  ICARUS_ESTADOS_EXCEL: { label: "ICARUS", color: "text-blue-600 bg-blue-500/10", icon: FileText },
  SCRAPER: { label: "Rama Judicial", color: "text-emerald-600 bg-emerald-500/10", icon: RefreshCw },
  CPNU: { label: "CPNU", color: "text-purple-600 bg-purple-500/10", icon: Database },
  MANUAL: { label: "Manual", color: "text-amber-600 bg-amber-500/10", icon: FileText },
  DEFAULT: { label: "Sistema", color: "text-muted-foreground bg-muted/50", icon: Database },
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
  
  // Fetch estados from work_item_acts table
  const { data: estados, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["work-item-estados", workItem.id],
    queryFn: async () => {
      // Fetch from work_item_acts table
      const { data: acts, error } = await supabase
        .from("work_item_acts")
        .select("*")
        .eq("work_item_id", workItem.id)
        .order("act_date", { ascending: false });
      
      if (error) throw error;
      
      if (acts && acts.length > 0) {
        return acts.map((act: any) => ({
          id: act.id,
          act_date: act.act_date,
          act_date_raw: act.act_date_raw,
          description: act.description,
          act_type: act.act_type,
          source: act.source || "DEFAULT",
          source_reference: act.source_reference,
          milestone_type: act.act_type || null,
          triggers_phase_change: false,
          created_at: act.created_at,
          raw_data: act.raw_data,
        })) as Estado[];
      }
      
      // Fallback to legacy actuaciones table if no work_item_acts
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
            act_date: act.act_date,
            act_date_raw: act.act_date_raw,
            description: act.normalized_text || act.raw_text,
            act_type: act.act_type_guess,
            source: act.adapter_name || "LEGACY",
            source_reference: act.source_url,
            milestone_type: null,
            triggers_phase_change: false,
            created_at: act.created_at,
            raw_data: null,
          })) as Estado[];
        }
      }
      
      return [];
    },
    enabled: !!workItem.id,
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

  const handleApplyStage = (estado: Estado) => {
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
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Estados y Actuaciones
              <Badge variant="secondary" className="ml-2">
                {estados?.length || 0} registros
              </Badge>
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Historial de actuaciones importadas desde ICARUS o sincronizadas desde la Rama Judicial.
            El sistema sugiere automáticamente la etapa del proceso basándose en el contenido.
          </p>
        </CardContent>
      </Card>

      {/* Empty state */}
      {!estados || estados.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Scale className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">Sin estados registrados</h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Los estados aparecerán aquí cuando importes un archivo de Estados de ICARUS
                o cuando se sincronicen automáticamente desde la Rama Judicial.
              </p>
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
                        {estado.act_type && !milestoneConfig && estado.act_type !== 'ESTADO' && (
                          <Badge variant="secondary" className="text-xs">
                            {estado.act_type}
                          </Badge>
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
                      {estado.act_date_raw && estado.act_date_raw !== estado.act_date && (
                        <p className="text-xs text-muted-foreground italic">
                          Fecha original: {estado.act_date_raw}
                        </p>
                      )}
                    </div>

                    {/* Right side: Date and actions */}
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {estado.act_date ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {format(new Date(estado.act_date), "d MMM yyyy", { locale: es })}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(estado.act_date), { addSuffix: true, locale: es })}
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
