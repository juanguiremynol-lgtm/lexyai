/**
 * Stage Suggestion Review Modal
 * 
 * Displays stage suggestions after estados import and allows user to:
 * - Apply suggestions per item
 * - Apply all suggestions at once
 * - Override with manual stage selection
 * - Dismiss all and keep current stages
 */

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  X,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Loader2,
  ChevronDown,
  Scale,
  FileText,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  type StageSuggestionRun,
  type StageSuggestion,
  applyStageSuggestion,
  applyManualStageOverride,
  dismissSuggestions,
  bulkApplySuggestions,
  getAvailableStagesForOverride,
} from "@/lib/ingestion/stage-suggestion-engine";
import { WORKFLOW_TYPES, type WorkflowType, type CGPPhase } from "@/lib/workflow-constants";

interface StageSuggestionReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestionRun: StageSuggestionRun | null;
  ownerId: string;
  organizationId?: string;
  newEstadosCount?: number;
  duplicateCount?: number;
}

type ItemStatus = 'pending' | 'applied' | 'dismissed' | 'overridden';

interface ItemState {
  status: ItemStatus;
  overriddenStage?: string;
  overriddenPhase?: CGPPhase | null;
}

// Confidence styling
const CONFIDENCE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  HIGH: { label: "Alta", color: "text-emerald-700", bgColor: "bg-emerald-100 dark:bg-emerald-900/30" },
  MEDIUM: { label: "Media", color: "text-amber-700", bgColor: "bg-amber-100 dark:bg-amber-900/30" },
  LOW: { label: "Baja", color: "text-slate-600", bgColor: "bg-slate-100 dark:bg-slate-800/50" },
};

export function StageSuggestionReviewModal({
  open,
  onOpenChange,
  suggestionRun,
  ownerId,
  organizationId,
  newEstadosCount = 0,
  duplicateCount = 0,
}: StageSuggestionReviewModalProps) {
  const queryClient = useQueryClient();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [applyingItemId, setApplyingItemId] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const suggestions = suggestionRun?.suggestions || [];

  // Computed stats
  const stats = useMemo(() => {
    const withChanges = suggestions.filter(s => s.is_different);
    const noChanges = suggestions.filter(s => !s.is_different);
    const applied = Object.values(itemStates).filter(s => s.status === 'applied' || s.status === 'overridden').length;
    const dismissed = Object.values(itemStates).filter(s => s.status === 'dismissed').length;
    const pending = suggestions.length - applied - dismissed;
    
    return {
      total: suggestions.length,
      withChanges: withChanges.length,
      noChanges: noChanges.length,
      applied,
      dismissed,
      pending,
    };
  }, [suggestions, itemStates]);

  // Get pending suggestions with changes
  const pendingSuggestionsWithChanges = useMemo(() => {
    return suggestions.filter(s => 
      s.is_different && 
      itemStates[s.work_item_id]?.status !== 'applied' && 
      itemStates[s.work_item_id]?.status !== 'dismissed' &&
      itemStates[s.work_item_id]?.status !== 'overridden'
    );
  }, [suggestions, itemStates]);

  const handleApplySuggestion = async (suggestion: StageSuggestion) => {
    setApplyingItemId(suggestion.work_item_id);
    
    const result = await applyStageSuggestion(suggestion, ownerId, organizationId);
    
    if (result.success) {
      setItemStates(prev => ({
        ...prev,
        [suggestion.work_item_id]: { status: 'applied' },
      }));
      toast.success(`Etapa actualizada: ${suggestion.suggested_stage_label}`);
      invalidateQueries();
    } else {
      toast.error(`Error: ${result.error}`);
    }
    
    setApplyingItemId(null);
  };

  const handleApplyOverride = async (
    suggestion: StageSuggestion,
    selectedStage: string,
    selectedPhase: CGPPhase | null
  ) => {
    setApplyingItemId(suggestion.work_item_id);
    
    const result = await applyManualStageOverride(
      suggestion.work_item_id,
      selectedStage,
      selectedPhase,
      ownerId,
      organizationId,
      suggestion
    );
    
    if (result.success) {
      setItemStates(prev => ({
        ...prev,
        [suggestion.work_item_id]: {
          status: 'overridden',
          overriddenStage: selectedStage,
          overriddenPhase: selectedPhase,
        },
      }));
      toast.success("Etapa actualizada manualmente");
      invalidateQueries();
    } else {
      toast.error(`Error: ${result.error}`);
    }
    
    setApplyingItemId(null);
    setExpandedItem(null);
  };

  const handleDismissSingle = async (suggestion: StageSuggestion) => {
    await dismissSuggestions([suggestion], 'SINGLE', ownerId, organizationId);
    setItemStates(prev => ({
      ...prev,
      [suggestion.work_item_id]: { status: 'dismissed' },
    }));
  };

  const handleApplyAll = async () => {
    setIsApplyingAll(true);
    
    const result = await bulkApplySuggestions(
      pendingSuggestionsWithChanges,
      ownerId,
      organizationId
    );
    
    // Update states for applied items
    const newStates = { ...itemStates };
    pendingSuggestionsWithChanges.forEach(s => {
      newStates[s.work_item_id] = { status: 'applied' };
    });
    setItemStates(newStates);
    
    if (result.failed > 0) {
      toast.warning(`Aplicadas ${result.applied} etapas, ${result.failed} errores`);
    } else {
      toast.success(`Aplicadas ${result.applied} etapas exitosamente`);
    }
    
    invalidateQueries();
    setIsApplyingAll(false);
  };

  const handleDismissAll = async () => {
    await dismissSuggestions(suggestions, 'BULK', ownerId, organizationId);
    onOpenChange(false);
  };

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["work-items"] });
    queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
    queryClient.invalidateQueries({ queryKey: ["cgp-pipeline"] });
    queryClient.invalidateQueries({ queryKey: ["cpaca-pipeline"] });
    queryClient.invalidateQueries({ queryKey: ["tutelas-pipeline"] });
    queryClient.invalidateQueries({ queryKey: ["peticiones-pipeline"] });
  };

  const handleClose = () => {
    // Dismiss any remaining pending suggestions
    const pendingSuggestions = suggestions.filter(s => 
      !itemStates[s.work_item_id] || itemStates[s.work_item_id].status === 'pending'
    );
    if (pendingSuggestions.length > 0) {
      dismissSuggestions(pendingSuggestions, 'BULK', ownerId, organizationId);
    }
    onOpenChange(false);
  };

  if (!suggestionRun) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-500" />
            Revisar Sugerencias de Etapa
          </DialogTitle>
          <DialogDescription>
            {newEstadosCount > 0 ? (
              <>
                Se importaron <strong>{newEstadosCount}</strong> nuevos estados
                {duplicateCount > 0 && ` (${duplicateCount} duplicados omitidos)`}.
              </>
            ) : (
              <>
                No se detectaron estados nuevos
                {duplicateCount > 0 && ` (${duplicateCount} ya existían)`}.
                El sistema aún puede re-evaluar las etapas actuales.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Stats Bar */}
        <div className="flex items-center gap-3 py-3 px-1 border-b">
          <Badge variant="outline" className="gap-1">
            <Scale className="h-3 w-3" />
            {stats.total} procesos
          </Badge>
          {stats.withChanges > 0 && (
            <Badge className="gap-1 bg-amber-500">
              <Lightbulb className="h-3 w-3" />
              {stats.withChanges} con cambios sugeridos
            </Badge>
          )}
          {stats.applied > 0 && (
            <Badge className="gap-1 bg-emerald-500">
              <CheckCircle2 className="h-3 w-3" />
              {stats.applied} aplicados
            </Badge>
          )}
          {stats.noChanges > 0 && (
            <Badge variant="secondary" className="gap-1">
              Sin cambios: {stats.noChanges}
            </Badge>
          )}
        </div>

        {/* Suggestions List */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3 py-2">
            {suggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No hay procesos afectados por esta importación</p>
              </div>
            ) : (
              suggestions.map((suggestion) => {
                const state = itemStates[suggestion.work_item_id];
                const isApplied = state?.status === 'applied' || state?.status === 'overridden';
                const isDismissed = state?.status === 'dismissed';
                const isExpanded = expandedItem === suggestion.work_item_id;
                const isApplying = applyingItemId === suggestion.work_item_id;
                const confidenceConfig = CONFIDENCE_CONFIG[suggestion.confidence];
                const workflowInfo = WORKFLOW_TYPES[suggestion.workflow_type];

                return (
                  <Card
                    key={suggestion.work_item_id}
                    className={cn(
                      "transition-all",
                      isApplied && "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-300/50",
                      isDismissed && "opacity-50 bg-muted/30",
                      suggestion.is_different && !isApplied && !isDismissed && "border-amber-300/50"
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        {/* Left side: Work item info */}
                        <div className="flex-1 min-w-0 space-y-2">
                          {/* Header row */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge
                              className="text-xs"
                              style={{
                                backgroundColor: `hsl(var(--${workflowInfo?.color || 'primary'}))`,
                                color: 'white',
                              }}
                            >
                              {workflowInfo?.shortLabel || suggestion.workflow_type}
                            </Badge>
                            <span className="font-mono text-sm font-medium">
                              {suggestion.radicado || suggestion.title || 'Sin identificador'}
                            </span>
                            {suggestion.client_name && (
                              <span className="text-sm text-muted-foreground">
                                • {suggestion.client_name}
                              </span>
                            )}
                          </div>

                          {/* Stage change visualization */}
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-normal">
                              {suggestion.current_stage_label}
                            </Badge>
                            
                            {suggestion.is_different && suggestion.suggested_stage_label && (
                              <>
                                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                                <Badge className={cn("font-normal gap-1", confidenceConfig?.bgColor, confidenceConfig?.color)}>
                                  <Lightbulb className="h-3 w-3" />
                                  {suggestion.suggested_stage_label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  ({confidenceConfig?.label || suggestion.confidence})
                                </span>
                              </>
                            )}
                            
                            {!suggestion.is_different && (
                              <span className="text-sm text-muted-foreground flex items-center gap-1">
                                <Check className="h-3 w-3" />
                                Sin cambios sugeridos
                              </span>
                            )}

                            {isApplied && (
                              <Badge className="bg-emerald-500 text-white gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Aplicado
                              </Badge>
                            )}
                          </div>

                          {/* Reasoning */}
                          {suggestion.reasoning && !isDismissed && (
                            <p className="text-xs text-muted-foreground">
                              {suggestion.reasoning}
                              {suggestion.triggering_estado && (
                                <span className="ml-1">
                                  ({suggestion.triggering_estado.act_date || 'fecha desconocida'})
                                </span>
                              )}
                            </p>
                          )}

                          {/* Override dropdown (when expanded) */}
                          {isExpanded && !isApplied && !isDismissed && (
                            <div className="pt-2 border-t mt-2">
                              <p className="text-sm font-medium mb-2">Seleccionar otra etapa:</p>
                              <StageOverrideSelect
                                workflowType={suggestion.workflow_type}
                                cgpPhase={suggestion.current_cgp_phase}
                                currentStage={suggestion.current_stage}
                                onSelect={(stage, phase) => 
                                  handleApplyOverride(suggestion, stage, phase)
                                }
                                isLoading={isApplying}
                              />
                            </div>
                          )}
                        </div>

                        {/* Right side: Actions */}
                        {!isApplied && !isDismissed && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {suggestion.is_different && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                      onClick={() => handleApplySuggestion(suggestion)}
                                      disabled={isApplying}
                                    >
                                      {isApplying ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Check className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Aplicar sugerencia</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => setExpandedItem(isExpanded ? null : suggestion.work_item_id)}
                                  >
                                    <ChevronDown className={cn(
                                      "h-4 w-4 transition-transform",
                                      isExpanded && "rotate-180"
                                    )} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Elegir otra etapa</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => handleDismissSingle(suggestion)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Mantener etapa actual</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row justify-between gap-2 pt-4 border-t">
          <Button
            variant="ghost"
            onClick={handleDismissAll}
            className="text-muted-foreground"
          >
            Descartar todo y cerrar
          </Button>
          
          <div className="flex items-center gap-2">
            {pendingSuggestionsWithChanges.length > 0 && (
              <Button
                variant="default"
                onClick={handleApplyAll}
                disabled={isApplyingAll}
                className="gap-2"
              >
                {isApplyingAll ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Aplicar todos ({pendingSuggestionsWithChanges.length})
              </Button>
            )}
            
            <Button variant="outline" onClick={handleClose}>
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Stage override select component
interface StageOverrideSelectProps {
  workflowType: WorkflowType;
  cgpPhase: CGPPhase | null;
  currentStage: string;
  onSelect: (stage: string, phase: CGPPhase | null) => void;
  isLoading: boolean;
}

function StageOverrideSelect({
  workflowType,
  cgpPhase,
  currentStage,
  onSelect,
  isLoading,
}: StageOverrideSelectProps) {
  const [selectedStage, setSelectedStage] = useState<string>('');
  const stages = getAvailableStagesForOverride(workflowType, cgpPhase);

  const handleApply = () => {
    if (selectedStage) {
      onSelect(selectedStage, cgpPhase);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedStage} onValueChange={setSelectedStage}>
        <SelectTrigger className="w-[240px]">
          <SelectValue placeholder="Seleccionar etapa..." />
        </SelectTrigger>
        <SelectContent>
          {stages.map((stage) => (
            <SelectItem
              key={stage.key}
              value={stage.key}
              disabled={stage.key === currentStage}
            >
              {stage.label}
              {stage.key === currentStage && " (actual)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        onClick={handleApply}
        disabled={!selectedStage || isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Aplicar"
        )}
      </Button>
    </div>
  );
}
