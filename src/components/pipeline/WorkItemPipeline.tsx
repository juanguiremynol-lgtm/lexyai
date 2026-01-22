/**
 * WorkItemPipeline - Unified CGP pipeline using work_items table
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'CGP'
 * - Phase (FILING/PROCESS) is DERIVED from stage automatically
 * - Kanban drag-and-drop updates stage AND phase atomically
 * - Query invalidation ensures dashboard/lists stay in sync
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
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Keyboard, CheckSquare, FileText, Scale } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WorkItemPipelineColumn, WorkItemStageConfig } from "./WorkItemPipelineColumn";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import {
  getMergedKanbanStages,
  getFirstStageOfMergedColumn,
  derivePhaseFromStage,
  findMergedColumnForStage,
  type CGPPhase,
  type MergedStageConfig,
} from "@/lib/cgp-stage-phase-mapping";

// Convert our merged stage config to the column component's expected format
function toColumnStageConfig(merged: MergedStageConfig): WorkItemStageConfig {
  return {
    id: merged.id,
    label: merged.label,
    shortLabel: merged.shortLabel,
    color: merged.color,
    phase: merged.phase,
  };
}

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

  // Get merged kanban stages from our canonical mapping
  const mergedStages = useMemo(() => getMergedKanbanStages(), []);

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
        is_flagged: item.is_flagged ?? false,
        last_action_date: item.last_action_date,
        last_checked_at: item.last_checked_at,
        monitoring_enabled: item.monitoring_enabled ?? false,
        auto_admisorio_date: item.auto_admisorio_date,
        created_at: item.created_at,
      }));
    },
  });

  /**
   * CRITICAL MUTATION: Atomic stage + phase update
   * This is the ONLY way to change an item's stage/phase
   * Phase is ALWAYS derived from stage - never set independently
   */
  const updateStageMutation = useMutation({
    mutationFn: async ({ itemId, newStage }: { itemId: string; newStage: string }) => {
      // Derive phase deterministically from the new stage
      const newPhase = derivePhaseFromStage(newStage);
      
      const { error } = await supabase
        .from("work_items")
        .update({ 
          stage: newStage, 
          cgp_phase: newPhase,
          cgp_phase_source: "MANUAL", // Track that this came from user action
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      
      if (error) throw error;
      
      return { itemId, newStage, newPhase };
    },
    onSuccess: ({ newPhase }) => {
      // Invalidate ALL relevant queries to keep everything in sync
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-mappings"] });
      
      // Show appropriate message based on phase change
      toast.success("Etapa actualizada");
    },
    onError: (error) => {
      console.error("Error updating stage:", error);
      toast.error("Error al actualizar etapa");
    },
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
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
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

    const targetMergedColumnId = over.id as string;
    
    // Get the first stage of the target merged column
    const targetStage = getFirstStageOfMergedColumn(targetMergedColumnId);
    if (!targetStage) {
      console.warn("Could not find target stage for column:", targetMergedColumnId);
      return;
    }

    // Check if already in a stage within this merged column
    const currentMergedColumn = findMergedColumnForStage(item.stage);
    if (currentMergedColumn?.id === targetMergedColumnId) {
      // Already in a stage within this column, no change needed
      return;
    }

    // Trigger the atomic update
    updateStageMutation.mutate({
      itemId: item.id,
      newStage: targetStage,
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

  // Organize items by merged column
  const itemsByMergedColumn = useMemo(() => {
    const result: Record<string, WorkItemPipelineItem[]> = {};
    
    // Initialize all columns with empty arrays
    mergedStages.forEach((stage) => {
      result[stage.id] = [];
    });

    // Assign each item to its merged column
    (workItems || []).forEach((item) => {
      const mergedColumn = findMergedColumnForStage(item.stage);
      if (mergedColumn && result[mergedColumn.id]) {
        result[mergedColumn.id].push(item);
      } else {
        // Fallback: place in first column of the item's phase
        const fallbackColumn = mergedStages.find(s => s.phase === item.cgp_phase);
        if (fallbackColumn) {
          result[fallbackColumn.id].push(item);
        }
      }
    });

    // Sort items within each column (flagged first, then by last action date)
    Object.keys(result).forEach(columnId => {
      result[columnId].sort((a, b) => {
        // Flagged items first
        if (a.is_flagged && !b.is_flagged) return -1;
        if (!a.is_flagged && b.is_flagged) return 1;
        // Then by last action date (most recent first)
        const dateA = a.last_action_date ? new Date(a.last_action_date).getTime() : 0;
        const dateB = b.last_action_date ? new Date(b.last_action_date).getTime() : 0;
        return dateB - dateA;
      });
    });

    return result;
  }, [workItems, mergedStages]);

  // Calculate counts by phase
  const filingCount = useMemo(() => 
    (workItems || []).filter(i => i.cgp_phase === "FILING").length, 
    [workItems]
  );
  const processCount = useMemo(() => 
    (workItems || []).filter(i => i.cgp_phase === "PROCESS").length, 
    [workItems]
  );

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
          {[...Array(6)].map((_, i) => (
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
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold">Pipeline CGP</h2>
              <p className="text-sm text-muted-foreground">{totalItems} casos activos</p>
            </div>
            {/* Phase summary badges */}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                <FileText className="h-3 w-3 mr-1" />
                {filingCount} Radicaciones
              </Badge>
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                <Scale className="h-3 w-3 mr-1" />
                {processCount} Procesos
              </Badge>
            </div>
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

        {/* Phase divider info */}
        <div className="text-xs text-muted-foreground flex items-center gap-2 px-2">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Etapas 1-3: RADICACIÓN (sin auto admisorio)
          </span>
          <span className="text-muted-foreground/50">→</span>
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Etapas 4+: PROCESO (con auto admisorio)
          </span>
        </div>

        {/* Pipeline columns */}
        <ScrollArea className="pb-4">
          <div className="flex gap-3 min-h-[500px]">
            {mergedStages.map((stage) => (
              <WorkItemPipelineColumn
                key={stage.id}
                stage={toColumnStageConfig(stage)}
                items={itemsByMergedColumn[stage.id] || []}
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
