/**
 * WorkItemPipeline - Unified CGP pipeline using work_items table
 * Queries work_items where workflow_type = 'CGP' and displays in kanban stages
 */

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
import { Button } from "@/components/ui/button";
import { RefreshCw, Keyboard, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WorkItemPipelineColumn, WorkItemStageConfig } from "./WorkItemPipelineColumn";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import {
  CGP_FILING_STAGES,
  CGP_PROCESS_STAGES,
  type CGPPhase,
} from "@/lib/workflow-constants";

// Build unified stages configuration combining FILING + PROCESS phases
const FILING_STAGES: WorkItemStageConfig[] = Object.entries(CGP_FILING_STAGES).map(([key, config]) => ({
  id: `FILING:${key}`,
  label: config.label,
  shortLabel: config.label.length > 15 ? config.label.substring(0, 15) + "..." : config.label,
  color: "blue",
  phase: "FILING" as const,
}));

const PROCESS_STAGES: WorkItemStageConfig[] = Object.entries(CGP_PROCESS_STAGES).map(([key, config]) => ({
  id: `PROCESS:${key}`,
  label: config.label,
  shortLabel: config.label.length > 15 ? config.label.substring(0, 15) + "..." : config.label,
  color: "emerald",
  phase: "PROCESS" as const,
}));

const ALL_STAGES: WorkItemStageConfig[] = [...FILING_STAGES, ...PROCESS_STAGES];

export function WorkItemPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<WorkItemPipelineItem | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch work_items for CGP workflow
  const { data: workItems, isLoading, refetch } = useQuery({
    queryKey: ["work-items-cgp-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id, workflow_type, stage, cgp_phase, status,
          radicado, title, authority_name, demandantes, demandados,
          is_flagged, last_action_date, last_checked_at, monitoring_enabled,
          auto_admisorio_date, created_at,
          client_id, clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("workflow_type", "CGP")
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED");

      if (error) throw error;
      
      return (data || []).map((item): WorkItemPipelineItem => ({
        id: item.id,
        workflow_type: item.workflow_type as any,
        stage: item.stage,
        cgp_phase: item.cgp_phase as CGPPhase | null,
        radicado: item.radicado,
        title: item.title,
        client_id: item.client_id,
        client_name: (item.clients as any)?.name || null,
        authority_name: item.authority_name,
        demandantes: item.demandantes,
        demandados: item.demandados,
        is_flagged: item.is_flagged,
        last_action_date: item.last_action_date,
        last_checked_at: item.last_checked_at,
        monitoring_enabled: item.monitoring_enabled,
        auto_admisorio_date: item.auto_admisorio_date,
        created_at: item.created_at,
      }));
    },
  });

  // Mutation for updating work item stage
  const updateStageMutation = useMutation({
    mutationFn: async ({ itemId, newStage, newPhase }: { itemId: string; newStage: string; newPhase: CGPPhase }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ 
          stage: newStage, 
          cgp_phase: newPhase,
          cgp_phase_source: "MANUAL" 
        })
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      toast.success("Etapa actualizada");
    },
    onError: () => toast.error("Error al actualizar etapa"),
  });

  // Mutation for toggling flag
  const toggleFlagMutation = useMutation({
    mutationFn: async (item: WorkItemPipelineItem) => {
      const { error } = await supabase
        .from("work_items")
        .update({ is_flagged: !item.is_flagged })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
    },
    onError: () => toast.error("Error al actualizar bandera"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Delete work_item_acts first
      await supabase.from("work_item_acts").delete().in("work_item_id", ids);
      
      // Delete work_items
      const { error } = await supabase.from("work_items").delete().in("id", ids);
      if (error) throw error;
      
      return ids;
    },
    onSuccess: (ids) => {
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setDeleteDialog(false);
      toast.success(`${ids.length} elemento${ids.length !== 1 ? "s" : ""} eliminado${ids.length !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al eliminar elementos"),
  });

  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const item = workItems?.find(i => i.id === itemId);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const itemId = active.id as string;
    const item = workItems?.find(i => i.id === itemId);
    if (!item) return;

    const targetStageId = over.id as string;
    const targetStage = ALL_STAGES.find(s => s.id === targetStageId);
    if (!targetStage) return;

    // Parse target phase and stage from ID (e.g., "FILING:SENT_TO_REPARTO" or "PROCESS:AUTO_ADMISORIO")
    const [targetPhase, targetStageName] = targetStageId.split(":") as [CGPPhase, string];
    
    // Check if already in this stage
    const currentStageId = `${item.cgp_phase}:${item.stage}`;
    if (currentStageId === targetStageId) return;

    updateStageMutation.mutate({
      itemId: item.id,
      newStage: targetStageName,
      newPhase: targetPhase,
    });
  }, [workItems, updateStageMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Selection handlers
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds(new Set());
    }
    setIsSelectionMode(!isSelectionMode);
  };

  const toggleItemSelection = (item: WorkItemPipelineItem) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(item.id)) {
        newSet.delete(item.id);
      } else {
        newSet.add(item.id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set((workItems || []).map(i => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Memoize itemsByStage
  const itemsByStage = useMemo(() => {
    const result: Record<string, WorkItemPipelineItem[]> = {};
    ALL_STAGES.forEach((stage) => {
      result[stage.id] = [];
    });

    (workItems || []).forEach((item) => {
      const stageId = `${item.cgp_phase}:${item.stage}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        // Fallback: place in first stage of the item's phase
        const fallbackStageId = item.cgp_phase === "PROCESS" 
          ? PROCESS_STAGES[0]?.id 
          : FILING_STAGES[0]?.id;
        if (fallbackStageId && result[fallbackStageId]) {
          result[fallbackStageId].push(item);
        }
      }
    });

    return result;
  }, [workItems]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-[500px] min-w-[280px]" />
          ))}
        </div>
      </div>
    );
  }

  const totalItems = workItems?.length || 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold">Pipeline CGP</h2>
            <p className="text-sm text-muted-foreground">{totalItems} casos activos</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              title="Actualizar"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              size="sm"
              onClick={toggleSelectionMode}
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              {isSelectionMode ? "Cancelar" : "Seleccionar"}
            </Button>
            <Button
              variant={isKeyboardMode ? "default" : "outline"}
              size="sm"
              onClick={() => setIsKeyboardMode(!isKeyboardMode)}
              title="Navegación con teclado"
            >
              <Keyboard className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Pipeline columns */}
        <ScrollArea className="pb-4">
          <div className="flex gap-3 min-h-[500px]">
            {ALL_STAGES.map((stage) => (
              <WorkItemPipelineColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                focusedItemId={focusedItemId}
                selectedItemIds={selectedIds}
                isSelectionMode={isSelectionMode}
                onToggleSelection={(item) => toggleItemSelection(item)}
                onToggleFlag={(item) => toggleFlagMutation.mutate(item)}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Drag overlay */}
        <DragOverlay>
          {activeItem && (
            <WorkItemPipelineCard item={activeItem} isDragging />
          )}
        </DragOverlay>
      </div>

      {/* Bulk actions */}
      {isSelectionMode && selectedIds.size > 0 && (
        <WorkItemBulkActionsBar
          selectedCount={selectedIds.size}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onBulkDelete={() => setDeleteDialog(true)}
          isDeleting={bulkDeleteMutation.isPending}
        />
      )}

      <WorkItemBulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        selectedCount={selectedIds.size}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
        isDeleting={bulkDeleteMutation.isPending}
      />
    </DndContext>
  );
}
