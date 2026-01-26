import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gavel, CheckSquare, Keyboard, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  TUTELA_STAGES,
  type TutelaStage,
} from "@/lib/workflow-constants";
import {
  TUTELA_PHASES,
  TUTELA_PHASES_ORDER,
  TUTELA_FINAL_PHASES,
  type TutelaPhase,
} from "@/lib/tutela-constants";
import { TutelaColumn, TutelaStageConfig } from "./TutelaColumn";
import { TutelaCard, TutelaItem } from "./TutelaCard";
import { NewTutelaDialog } from "./NewTutelaDialog";
import { NewHabeasCorpusDialog } from "./NewHabeasCorpusDialog";
import { FalloOutcomeDialog } from "./FalloOutcomeDialog";
import { ArchivePromptDialog } from "./ArchivePromptDialog";
import { TutelasBulkActionsBar } from "./TutelasBulkActionsBar";
import { TutelasBulkDeleteDialog } from "./TutelasBulkDeleteDialog";
import { DesacatoPipeline } from "./DesacatoPipeline";
import { InitiateDesacatoDialog } from "./InitiateDesacatoDialog";
import { ReportIncumplimientoDialog } from "./ReportIncumplimientoDialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";

// Map work_items.stage to tutela phase for display purposes
function stageToPhase(stage: string): TutelaPhase {
  // Direct mapping - stage keys match phase keys in TUTELA_STAGES
  if (stage === "TUTELA_RADICADA") return "TUTELA_RADICADA";
  if (stage === "TUTELA_ADMITIDA") return "TUTELA_ADMITIDA";
  if (stage === "FALLO_PRIMERA_INSTANCIA") return "FALLO_PRIMERA_INSTANCIA";
  if (stage === "FALLO_SEGUNDA_INSTANCIA") return "FALLO_SEGUNDA_INSTANCIA";
  if (stage === "ARCHIVADO") return "FALLO_SEGUNDA_INSTANCIA"; // Archivado maps to final phase
  // Fallback
  return "TUTELA_RADICADA";
}

// Build stages configuration from TUTELA_STAGES (canonical source)
const TUTELA_STAGE_CONFIGS: TutelaStageConfig[] = Object.entries(TUTELA_STAGES)
  .sort((a, b) => a[1].order - b[1].order)
  .filter(([key]) => key !== "ARCHIVADO") // Exclude ARCHIVADO from Kanban columns
  .map(([key, value]) => {
    const phase = stageToPhase(key);
    const phaseConfig = TUTELA_PHASES[phase];
    return {
      id: `tutela:${key}`,
      label: value.label,
      shortLabel: phaseConfig?.shortLabel || value.label,
      color: phaseConfig?.color || "bg-slate-500",
      phase,
    };
  });

interface RawWorkItem {
  id: string;
  workflow_type: string;
  stage: string | null;
  radicado: string | null;
  authority_name: string | null;
  created_at: string;
  status: string;
  auto_admisorio_date: string | null;
  demandantes: string | null;
  demandados: string | null;
  last_reviewed_at: string | null;
  client_id: string | null;
  is_flagged: boolean | null;
  clients: { id: string; name: string } | null;
  // For tutela-specific fields, we'll use notes/description for compliance tracking
  notes: string | null;
}

function rawToTutelaItem(raw: RawWorkItem): TutelaItem {
  const stage = raw.stage || "TUTELA_RADICADA";
  const phase = stageToPhase(stage);
  const isFinalPhase = TUTELA_FINAL_PHASES.includes(phase);
  
  // Check for favorable ruling - we'll derive from notes or a specific field
  // For now, assume favorable if auto_admisorio_date is set (simplified logic)
  const isFavorable = raw.auto_admisorio_date !== null;
  
  return {
    id: raw.id,
    type: "tutela" as const,
    filingType: "TUTELA",
    radicado: raw.radicado,
    courtName: raw.authority_name,
    createdAt: raw.created_at,
    status: raw.status || "ACTIVE",
    phase,
    clientId: raw.client_id,
    clientName: raw.clients?.name || null,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    lastArchivedPromptAt: raw.last_reviewed_at,
    isFavorable: isFinalPhase ? isFavorable : null,
    isFlagged: raw.is_flagged ?? false,
    complianceReported: false, // Would need dedicated field
    complianceReportedAt: null,
    hasDesacatoIncident: false, // Would need separate query
  };
}

export function TutelasPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<TutelaItem | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [habeasDialogOpen, setHabeasDialogOpen] = useState(false);
  const [falloDialog, setFalloDialog] = useState<{
    open: boolean;
    tutela: TutelaItem | null;
    targetPhase: TutelaPhase;
  }>({ open: false, tutela: null, targetPhase: "FALLO_PRIMERA_INSTANCIA" });
  const [archiveDialog, setArchiveDialog] = useState<{
    open: boolean;
    tutelaId: string | null;
    label: string;
  }>({ open: false, tutelaId: null, label: "" });
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [desacatoDialog, setDesacatoDialog] = useState<{
    open: boolean;
    tutela: TutelaItem | null;
  }>({ open: false, tutela: null });
  const [incumplimientoDialog, setIncumplimientoDialog] = useState<{
    open: boolean;
    tutela: TutelaItem | null;
  }>({ open: false, tutela: null });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch tutelas from CANONICAL work_items table
  const { data: tutelas, isLoading, refetch } = useQuery({
    queryKey: ["tutelas-work-items"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id, workflow_type, stage, radicado, authority_name, created_at, status,
          auto_admisorio_date, demandantes, demandados, last_reviewed_at,
          client_id, is_flagged, notes,
          clients(id, name)
        `)
        .eq("workflow_type", "TUTELA")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawWorkItem[]).map(rawToTutelaItem);
    },
  });

  // Toggle flag mutation
  // Toggle flag mutation - now uses work_items
  const toggleFlagMutation = useMutation({
    mutationFn: async ({ id, isFlagged }: { id: string; isFlagged: boolean }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ is_flagged: !isFlagged })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
    },
  });

  // Update stage mutation - now uses work_items.stage
  const updateStageMutation = useMutation({
    mutationFn: async ({ tutelaId, newStage }: { tutelaId: string; newStage: string }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ stage: newStage, updated_at: new Date().toISOString() })
        .eq("id", tutelaId);
      
      if (error) throw error;
      return { tutelaId, newStage };
    },
    onSuccess: ({ newStage }) => {
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      toast.success("Estado actualizado");
      
      // If moving to a fallo phase, open the outcome dialog
      const phase = stageToPhase(newStage);
      if (phase === "FALLO_PRIMERA_INSTANCIA" || phase === "FALLO_SEGUNDA_INSTANCIA") {
        const tutela = tutelas?.find(t => t.id === newStage);
        if (tutela) {
          setFalloDialog({ open: true, tutela, targetPhase: phase });
        }
      }
    },
    onError: () => toast.error("Error al actualizar estado"),
  });

  // Bulk delete mutation using edge function
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke("delete-work-items", {
        body: { work_item_ids: ids, mode: "HARD_DELETE" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${result?.deleted_count || 0} tutela${result?.deleted_count !== 1 ? "s" : ""} eliminada${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => {
      toast.error("Error al eliminar tutelas");
    },
  });

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const [, id] = itemId.split(":");
    const item = tutelas?.find(t => t.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const activeId = active.id as string;
    const [, itemId] = activeId.split(":");
    const [, targetStage] = (over.id as string).split(":");

    const item = tutelas?.find(t => t.id === itemId);
    if (!item) return;

    // Get current stage from item's phase
    const currentStage = item.phase;
    
    if (currentStage !== targetStage) {
      // If moving to a fallo phase, we need to ask about the outcome first
      const targetPhase = stageToPhase(targetStage);
      if (targetPhase === "FALLO_PRIMERA_INSTANCIA" || targetPhase === "FALLO_SEGUNDA_INSTANCIA") {
        setFalloDialog({ open: true, tutela: item, targetPhase });
      } else {
        updateStageMutation.mutate({ tutelaId: itemId, newStage: targetStage });
      }
    }
  }, [tutelas, updateStageMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Handle archive prompt for items in final phases
  const handleArchivePrompt = useCallback((item: TutelaItem) => {
    setArchiveDialog({
      open: true,
      tutelaId: item.id,
      label: `${item.radicado || "Sin radicado"} - ${item.demandantes || "Accionante"} vs ${item.demandados || "Accionado"}`,
    });
  }, []);

  // Handle initiate desacato for items with favorable ruling
  const handleInitiateDesacato = useCallback((item: TutelaItem) => {
    setDesacatoDialog({ open: true, tutela: item });
  }, []);

  // Handle report incumplimiento for items with favorable ruling
  const handleReportIncumplimiento = useCallback((item: TutelaItem) => {
    setIncumplimientoDialog({ open: true, tutela: item });
  }, []);

  // Handle toggle flag
  const handleToggleFlag = useCallback((item: TutelaItem) => {
    toggleFlagMutation.mutate({ id: item.id, isFlagged: item.isFlagged });
  }, [toggleFlagMutation]);

  // Group items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, TutelaItem[]> = {};
    TUTELA_STAGE_CONFIGS.forEach(stage => {
      result[stage.id] = [];
    });

    tutelas?.forEach(item => {
      const stageId = `tutela:${item.phase}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        // Fallback to first stage
        result[TUTELA_STAGE_CONFIGS[0].id].push(item);
      }
    });

    return result;
  }, [tutelas]);

  // Flatten items for batch selection
  const allItemsFlat = useMemo(() => {
    const items: { id: string; type: "tutela" }[] = [];
    TUTELA_STAGE_CONFIGS.forEach(stage => {
      itemsByStage[stage.id]?.forEach(item => {
        items.push({ id: item.id, type: "tutela" as const });
      });
    });
    return items;
  }, [itemsByStage]);

  // Batch selection
  const {
    isSelectionMode,
    toggleSelection,
    isSelected,
    selectAll,
    clearSelection,
    getSelectedItems,
    selectedCount,
  } = useBatchSelection({ allItems: allItemsFlat });

  // Wrapper to adapt selection for tutela type
  const isItemSelected = useCallback((item: { id: string; type: "tutela" }) => {
    return isSelected(item);
  }, [isSelected]);

  const toggleItemSelection = useCallback((item: { id: string; type: "tutela" }, shiftKey: boolean) => {
    toggleSelection(item, shiftKey);
  }, [toggleSelection]);

  const toggleSelectionMode = useCallback(() => {
    if (isSelectionMode) {
      clearSelection();
    } else {
      toast.info("Modo selección activado", {
        description: "Shift+click para seleccionar rango",
        duration: 3000,
      });
    }
  }, [isSelectionMode, clearSelection]);

  // Keyboard navigation - memoize stages for hook
  const stagesForKeyboard = useMemo(() => 
    TUTELA_STAGE_CONFIGS.map(s => ({ id: s.id, type: "tutela" as const })), 
    []
  );
  
  const { 
    isNavigating, 
    startNavigation, 
    getFocusedItemId 
  } = usePipelineKeyboard({
    stages: stagesForKeyboard,
    itemsByStage,
    onReclassify: () => {}, // No reclassification for tutelas
    enabled: !isSelectionMode,
  });

  const focusedItemId = getFocusedItemId();

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {TUTELA_STAGE_CONFIGS.map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const totalTutelas = tutelas?.length || 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Pipeline Tutelas</h2>
          <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 px-3 py-1">
            <Gavel className="h-3.5 w-3.5 mr-1.5" />
            {totalTutelas} Tutela{totalTutelas !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectionMode}
            className={isSelectionMode ? "ring-2 ring-primary bg-primary/10" : ""}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            {isSelectionMode ? "Cancelar" : "Seleccionar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startNavigation}
            className={isNavigating ? "ring-2 ring-primary" : ""}
            disabled={isSelectionMode}
          >
            <Keyboard className="h-4 w-4 mr-2" />
            {isNavigating ? "Navegando" : "Tab"}
          </Button>
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nueva Tutela
          </Button>
        </div>
      </div>

      {/* Pipeline */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-3 pb-4">
            {TUTELA_STAGE_CONFIGS.map((stage) => (
              <TutelaColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                focusedItemId={focusedItemId}
                isSelectionMode={isSelectionMode}
                isItemSelected={isItemSelected}
                onToggleSelection={toggleItemSelection}
                onArchivePrompt={handleArchivePrompt}
                onInitiateDesacato={handleInitiateDesacato}
                onReportIncumplimiento={handleReportIncumplimiento}
                onToggleFlag={handleToggleFlag}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? <TutelaCard item={activeItem} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <NewTutelaDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      <NewHabeasCorpusDialog open={habeasDialogOpen} onOpenChange={setHabeasDialogOpen} />
      
      <FalloOutcomeDialog
        open={falloDialog.open}
        onOpenChange={(open) => setFalloDialog(prev => ({ ...prev, open }))}
        tutela={falloDialog.tutela}
        targetPhase={falloDialog.targetPhase}
      />

      <ArchivePromptDialog
        open={archiveDialog.open}
        onOpenChange={(open) => setArchiveDialog(prev => ({ ...prev, open }))}
        itemId={archiveDialog.tutelaId}
        itemType="tutela"
        itemLabel={archiveDialog.label}
      />

      <TutelasBulkActionsBar
        selectedCount={selectedCount}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={() => setDeleteDialog(true)}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <TutelasBulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        count={selectedCount}
        onConfirm={() => {
          const ids = getSelectedItems().map(i => i.id);
          bulkDeleteMutation.mutate(ids);
        }}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <InitiateDesacatoDialog
        open={desacatoDialog.open}
        onOpenChange={(open) => setDesacatoDialog(prev => ({ ...prev, open }))}
        tutela={desacatoDialog.tutela}
      />

      <ReportIncumplimientoDialog
        open={incumplimientoDialog.open}
        onOpenChange={(open) => setIncumplimientoDialog(prev => ({ ...prev, open }))}
        tutela={incumplimientoDialog.tutela}
      />

      {/* Desacato Pipeline - only shows when there are incidents */}
      <DesacatoPipeline />
    </>
  );
}
