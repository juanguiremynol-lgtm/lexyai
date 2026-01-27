/**
 * Stage Suggestion Banner
 * 
 * Non-intrusive banner shown on WorkItemDetail when there's a pending
 * stage suggestion from the inference engine.
 * 
 * Actions: Apply, Dismiss, Override (manual selection)
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
  Lightbulb, 
  Check, 
  X, 
  Settings, 
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { 
  applyStageSuggestion, 
  applyManualStageOverride,
  dismissSuggestions,
  getAvailableStagesForOverride,
  type StageSuggestion,
} from "@/lib/ingestion/stage-suggestion-engine";

interface StageSuggestionBannerProps {
  suggestion: StageSuggestion;
  ownerId: string;
  organizationId?: string;
  onApplied: () => void;
  onDismissed: () => void;
}

const CONFIDENCE_COLORS = {
  HIGH: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  MEDIUM: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

export function StageSuggestionBanner({
  suggestion,
  ownerId,
  organizationId,
  onApplied,
  onDismissed,
}: StageSuggestionBannerProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [selectedOverrideStage, setSelectedOverrideStage] = useState<string | null>(null);
  
  // Don't show if no suggestion or not different
  if (!suggestion.is_different || !suggestion.suggested_stage) {
    return null;
  }
  
  const handleApply = async () => {
    setIsApplying(true);
    try {
      const result = await applyStageSuggestion(suggestion, ownerId, organizationId);
      if (result.success) {
        toast.success("Etapa actualizada correctamente");
        onApplied();
      } else {
        toast.error(result.error || "Error al aplicar sugerencia");
      }
    } catch (err) {
      toast.error("Error al aplicar sugerencia");
    } finally {
      setIsApplying(false);
    }
  };
  
  const handleDismiss = async () => {
    setIsDismissing(true);
    try {
      await dismissSuggestions([suggestion], 'SINGLE', ownerId, organizationId);
      toast.info("Sugerencia descartada");
      onDismissed();
    } catch (err) {
      toast.error("Error al descartar sugerencia");
    } finally {
      setIsDismissing(false);
    }
  };
  
  const handleOverrideConfirm = async () => {
    if (!selectedOverrideStage) return;
    
    setIsApplying(true);
    try {
      // Determine CGP phase from stage if applicable
      const cgpPhase = suggestion.workflow_type === 'CGP' 
        ? determineCgpPhaseFromStage(selectedOverrideStage)
        : null;
      
      const result = await applyManualStageOverride(
        suggestion.work_item_id,
        selectedOverrideStage,
        cgpPhase,
        ownerId,
        organizationId,
        suggestion
      );
      
      if (result.success) {
        toast.success("Etapa actualizada manualmente");
        setShowOverrideDialog(false);
        onApplied();
      } else {
        toast.error(result.error || "Error al actualizar etapa");
      }
    } catch (err) {
      toast.error("Error al actualizar etapa");
    } finally {
      setIsApplying(false);
    }
  };
  
  const availableStages = getAvailableStagesForOverride(
    suggestion.workflow_type,
    suggestion.current_cgp_phase
  );
  
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
              className={cn(CONFIDENCE_COLORS[suggestion.confidence])}
            >
              {suggestion.confidence === 'HIGH' ? 'Alta' : 
               suggestion.confidence === 'MEDIUM' ? 'Media' : 'Baja'} confianza
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Current -> Suggested transition */}
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              <span className="text-muted-foreground">Actual:</span>
              <span className="ml-2 font-medium">{suggestion.current_stage_label}</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <span className="text-muted-foreground">Sugerido:</span>
              <span className="ml-2 font-medium text-primary">
                {suggestion.suggested_stage_label}
              </span>
            </div>
          </div>
          
          {/* Reasoning */}
          <CardDescription className="text-xs">
            <strong>Razón:</strong> {suggestion.reasoning}
          </CardDescription>
          
          {/* Triggering estado info */}
          {suggestion.triggering_estado && (
            <CardDescription className="text-xs border-t pt-2">
              <strong>Basado en:</strong> {suggestion.triggering_estado.description?.slice(0, 100)}
              {suggestion.triggering_estado.description && suggestion.triggering_estado.description.length > 100 ? '...' : ''}
              {suggestion.triggering_estado.act_date && (
                <span className="ml-2 text-muted-foreground">
                  ({new Date(suggestion.triggering_estado.act_date).toLocaleDateString('es-CO')})
                </span>
              )}
            </CardDescription>
          )}
          
          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button 
              size="sm" 
              onClick={handleApply}
              disabled={isApplying || isDismissing}
            >
              <Check className="h-4 w-4 mr-1" />
              Aplicar
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => setShowOverrideDialog(true)}
              disabled={isApplying || isDismissing}
            >
              <Settings className="h-4 w-4 mr-1" />
              Elegir otra
            </Button>
            <Button 
              size="sm" 
              variant="ghost"
              onClick={handleDismiss}
              disabled={isApplying || isDismissing}
            >
              <X className="h-4 w-4 mr-1" />
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
              disabled={!selectedOverrideStage || isApplying}
            >
              Aplicar Selección
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Helper to determine CGP phase from stage key
function determineCgpPhaseFromStage(stage: string): 'FILING' | 'PROCESS' | null {
  const FILING_STAGES = ['DRAFTED', 'SENT_PENDING', 'RADICADO_CONFIRMED', 'ACTA_RECEIVED', 'PENDING_AUTO_ADMISORIO'];
  const PROCESS_STAGES = ['AUTO_ADMISORIO', 'NOTIFICACION_PERSONAL', 'NOTIFICACION_AVISO', 'EXCEPCIONES_PREVIAS', 'AUDIENCIA_INICIAL', 'AUDIENCIA_INSTRUCCION', 'ALEGATOS_SENTENCIA', 'APELACION'];
  
  if (FILING_STAGES.includes(stage)) return 'FILING';
  if (PROCESS_STAGES.includes(stage)) return 'PROCESS';
  return null;
}
