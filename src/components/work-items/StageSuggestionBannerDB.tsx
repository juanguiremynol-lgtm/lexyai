/**
 * Stage Suggestion Banner (Database-backed)
 * 
 * Reads suggestions from work_item_stage_suggestions table
 * and provides Apply/Dismiss/Override actions.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Check, 
  X, 
  Settings, 
  ArrowRight,
  Sparkles,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStageSuggestion, type StageSuggestionRecord } from "@/hooks/useStageSuggestion";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

interface StageSuggestionBannerDBProps {
  workItemId: string;
  workflowType: WorkflowType;
  currentStage: string | null;
  currentCgpPhase: CGPPhase | null;
  onRefresh?: () => void;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

// Stage options by workflow type
const STAGE_OPTIONS: Record<string, Array<{ key: string; label: string }>> = {
  CGP: [
    { key: "DRAFTED", label: "Borrador" },
    { key: "SENT_PENDING", label: "Enviado/Pendiente" },
    { key: "RADICADO_CONFIRMED", label: "Radicado Confirmado" },
    { key: "ACTA_RECEIVED", label: "Acta Recibida" },
    { key: "PENDING_AUTO_ADMISORIO", label: "Pendiente Auto Admisorio" },
    { key: "AUTO_ADMISORIO", label: "Auto Admisorio" },
    { key: "NOTIFICACION_PERSONAL", label: "Notificación Personal" },
    { key: "NOTIFICACION_AVISO", label: "Notificación por Aviso" },
    { key: "EXCEPCIONES_PREVIAS", label: "Excepciones Previas" },
    { key: "AUDIENCIA_INICIAL", label: "Audiencia Inicial" },
    { key: "AUDIENCIA_INSTRUCCION", label: "Audiencia de Instrucción" },
    { key: "ALEGATOS_SENTENCIA", label: "Alegatos/Sentencia" },
    { key: "APELACION", label: "Apelación" },
  ],
  CPACA: [
    { key: "DEMANDA_RADICADA", label: "Demanda Radicada" },
    { key: "AUTO_ADMISORIO", label: "Auto Admisorio" },
    { key: "TRASLADO", label: "Traslado" },
    { key: "CONTESTACION", label: "Contestación" },
    { key: "AUDIENCIA_INICIAL", label: "Audiencia Inicial" },
    { key: "AUDIENCIA_PRUEBAS", label: "Audiencia de Pruebas" },
    { key: "ALEGATOS", label: "Alegatos" },
    { key: "SENTENCIA", label: "Sentencia" },
  ],
  LABORAL: [
    { key: "DRAFT", label: "Borrador" },
    { key: "RADICACION", label: "Radicación" },
    { key: "ADMISION_PENDIENTE", label: "Admisión Pendiente" },
    { key: "AUDIENCIA_INICIAL", label: "Audiencia Inicial" },
    { key: "AUDIENCIA_JUZGAMIENTO", label: "Audiencia de Juzgamiento" },
    { key: "SENTENCIA_1A_INSTANCIA", label: "Sentencia 1ª Instancia" },
  ],
};

export function StageSuggestionBannerDB({
  workItemId,
  workflowType,
  currentStage,
  currentCgpPhase,
  onRefresh,
}: StageSuggestionBannerDBProps) {
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [selectedOverrideStage, setSelectedOverrideStage] = useState<string | null>(null);
  
  const {
    suggestion,
    isLoading,
    apply,
    dismiss,
    override,
    isApplying,
    isDismissing,
    isOverriding,
  } = useStageSuggestion({ workItemId });

  // Don't render if loading or no pending suggestion
  if (isLoading || !suggestion) {
    return null;
  }

  // Check if suggestion is actually different from current
  const isDifferent = suggestion.suggested_stage !== currentStage ||
    suggestion.suggested_cgp_phase !== currentCgpPhase;

  if (!isDifferent) {
    return null;
  }

  const confidenceLevel = suggestion.confidence >= 0.8 ? 'high' 
    : suggestion.confidence >= 0.5 ? 'medium' 
    : 'low';

  const confidenceLabel = confidenceLevel === 'high' ? 'Alta' 
    : confidenceLevel === 'medium' ? 'Media' 
    : 'Baja';

  const handleApply = () => {
    apply({
      suggestionId: suggestion.id,
      workItemId: suggestion.work_item_id,
      suggestedStage: suggestion.suggested_stage,
      suggestedCgpPhase: suggestion.suggested_cgp_phase,
      suggestedPipelineStage: suggestion.suggested_pipeline_stage,
    });
    onRefresh?.();
  };

  const handleDismiss = () => {
    dismiss(suggestion.id);
    onRefresh?.();
  };

  const handleOverrideConfirm = () => {
    if (!selectedOverrideStage) return;
    
    // Determine CGP phase from stage if applicable
    const cgpPhase = workflowType === 'CGP' 
      ? determineCgpPhaseFromStage(selectedOverrideStage)
      : null;
    
    override({
      workItemId,
      newStage: selectedOverrideStage,
      newCgpPhase: cgpPhase,
      suggestionId: suggestion.id,
    });
    setShowOverrideDialog(false);
    onRefresh?.();
  };

  const availableStages = STAGE_OPTIONS[workflowType] || STAGE_OPTIONS.CGP;
  const isProcessing = isApplying || isDismissing || isOverriding;

  return (
    <>
      <Card className="border-primary/30 bg-primary/5 mb-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Sugerencia de Etapa</CardTitle>
            </div>
            <Badge 
              variant="outline" 
              className={cn(CONFIDENCE_COLORS[confidenceLevel])}
            >
              {confidenceLabel} confianza ({Math.round(suggestion.confidence * 100)}%)
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Current -> Suggested transition */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              <span className="text-muted-foreground">Actual:</span>
              <span className="ml-2 font-medium">{currentStage || 'Sin etapa'}</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <span className="text-muted-foreground">Sugerido:</span>
              <span className="ml-2 font-medium text-primary">
                {suggestion.suggested_stage || suggestion.suggested_pipeline_stage || 'N/A'}
              </span>
            </div>
          </div>
          
          {/* Reasoning */}
          {suggestion.reason && (
            <CardDescription className="text-xs">
              <strong>Razón:</strong> {suggestion.reason}
            </CardDescription>
          )}
          
          {/* Source type */}
          <CardDescription className="text-xs border-t pt-2">
            <strong>Fuente:</strong> {suggestion.source_type}
            {suggestion.event_fingerprint && (
              <span className="ml-2 text-muted-foreground font-mono text-[10px]">
                ({suggestion.event_fingerprint.slice(0, 16)}...)
              </span>
            )}
          </CardDescription>
          
          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button 
              size="sm" 
              onClick={handleApply}
              disabled={isProcessing}
            >
              {isApplying ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Aplicar
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setShowOverrideDialog(true)}
              disabled={isProcessing}
            >
              <Settings className="h-4 w-4 mr-1" />
              Elegir otra
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={handleDismiss}
              disabled={isProcessing}
            >
              {isDismissing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-1" />
              )}
              Descartar
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Override Dialog */}
      <AlertDialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Seleccionar Etapa Manualmente</AlertDialogTitle>
            <AlertDialogDescription>
              Elige la etapa correcta para este asunto. Esta acción quedará registrada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="py-4">
            <Select
              value={selectedOverrideStage || undefined}
              onValueChange={setSelectedOverrideStage}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona una etapa..." />
              </SelectTrigger>
              <SelectContent>
                {availableStages.map((stage) => (
                  <SelectItem key={stage.key} value={stage.key}>
                    {stage.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleOverrideConfirm}
              disabled={!selectedOverrideStage || isOverriding}
            >
              {isOverriding ? "Aplicando..." : "Aplicar Selección"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Helper to determine CGP phase from stage key
function determineCgpPhaseFromStage(stage: string): CGPPhase | null {
  const FILING_STAGES = ['DRAFTED', 'SENT_PENDING', 'RADICADO_CONFIRMED', 'ACTA_RECEIVED', 'PENDING_AUTO_ADMISORIO'];
  const PROCESS_STAGES = ['AUTO_ADMISORIO', 'NOTIFICACION_PERSONAL', 'NOTIFICACION_AVISO', 'EXCEPCIONES_PREVIAS', 'AUDIENCIA_INICIAL', 'AUDIENCIA_INSTRUCCION', 'ALEGATOS_SENTENCIA', 'APELACION'];
  
  if (FILING_STAGES.includes(stage)) return 'FILING';
  if (PROCESS_STAGES.includes(stage)) return 'PROCESS';
  return null;
}
