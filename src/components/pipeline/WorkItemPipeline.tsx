/**
 * WorkItemPipeline - Unified CGP pipeline using work_items table
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'CGP'
 * - Phase (RADICACIÓN/PROCESO) is DERIVED from stage automatically (stages 1-3 = RADICACION, 4-13 = PROCESO)
 * - Kanban drag-and-drop updates stage AND phase atomically
 * - 13 columns based on Ley 1564 de 2012 (CGP)
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
import { RefreshCw, Keyboard, CheckSquare, FileText, Scale, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { WorkItemPipelineColumn, WorkItemStageConfig } from "./WorkItemPipelineColumn";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import {
  CGP_STAGES,
  derivePhaseFromStage,
  getOrderedCGPStages,
  type CGPPhase,
  type CGPStageConfig,
} from "@/lib/cgp-constants";

// Convert stage config to column component's expected format
function toColumnStageConfig(stage: CGPStageConfig): WorkItemStageConfig {
  return {
    id: stage.key,
    label: stage.label,
    shortLabel: stage.shortLabel,
    color: stage.color,
    phase: stage.phase === 'RADICACION' ? 'FILING' : 'PROCESS', // Map to pipeline's phase naming
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
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'RADICACION' | 'PROCESO'>('ALL');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Get all 13 CGP stages
  const stages = useMemo(() => getOrderedCGPStages(), []);

  // Filter stages by phase if filter is active
  const visibleStages = useMemo(() => {
    if (phaseFilter === 'ALL') return stages;
    return stages.filter(s => s.phase === phaseFilter);
  }, [stages, phaseFilter]);

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
          cgp_phase: newPhase as 'FILING' | 'PROCESS', // Map for DB compatibility
          cgp_phase_source: "MANUAL",
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      
      if (error) throw error;
      
      return { itemId, newStage, newPhase };
    },
    onSuccess: ({ newPhase, newStage }) => {
      // Invalidate ALL relevant queries to keep everything in sync
      queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cgp-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-item-mappings"] });
      
      const stageConfig = CGP_STAGES[newStage];
      toast.success(`Movido a: ${stageConfig?.label || newStage}`);
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
      await supabase.from("work_item_acts").delete().in("work_item_id", ids);
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

    const targetStage = over.id as string;
    
    // Skip if already in the same stage
    if (item.stage === targetStage) return;

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

  // Organize items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, WorkItemPipelineItem[]> = {};
    
    // Initialize all stages with empty arrays
    stages.forEach((stage) => {
      result[stage.key] = [];
    });

    // Assign each item to its stage
    (workItems || []).forEach((item) => {
      if (result[item.stage]) {
        result[item.stage].push(item);
      } else {
        // Fallback: place in first stage of the item's phase
        const fallbackStage = stages.find(s => s.phase === (item.cgp_phase || 'RADICACION'));
        if (fallbackStage) {
          result[fallbackStage.key].push(item);
        }
      }
    });

    // Sort items within each stage (flagged first, then by last action date)
    Object.keys(result).forEach(stageKey => {
      result[stageKey].sort((a, b) => {
        if (a.is_flagged && !b.is_flagged) return -1;
        if (!a.is_flagged && b.is_flagged) return 1;
        const dateA = a.last_action_date ? new Date(a.last_action_date).getTime() : 0;
        const dateB = b.last_action_date ? new Date(b.last_action_date).getTime() : 0;
        return dateB - dateA;
      });
    });

    return result;
  }, [workItems, stages]);

  // Calculate counts by phase
  const radicacionCount = useMemo(() => 
    (workItems || []).filter(i => derivePhaseFromStage(i.stage) === 'RADICACION').length, 
    [workItems]
  );
  const procesoCount = useMemo(() => 
    (workItems || []).filter(i => derivePhaseFromStage(i.stage) === 'PROCESO').length, 
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
        <div className="flex gap-3 overflow-x-auto pb-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[500px] min-w-[260px]" />
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
              <p className="text-sm text-muted-foreground">{totalItems} casos activos • 13 etapas</p>
            </div>
            {/* Phase summary badges */}
            <div className="flex items-center gap-2">
              <Badge 
                variant={phaseFilter === 'RADICACION' ? 'default' : 'outline'} 
                className="cursor-pointer bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                onClick={() => setPhaseFilter(phaseFilter === 'RADICACION' ? 'ALL' : 'RADICACION')}
              >
                <FileText className="h-3 w-3 mr-1" />
                {radicacionCount} Radicaciones
              </Badge>
              <Badge 
                variant={phaseFilter === 'PROCESO' ? 'default' : 'outline'} 
                className="cursor-pointer bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                onClick={() => setPhaseFilter(phaseFilter === 'PROCESO' ? 'ALL' : 'PROCESO')}
              >
                <Scale className="h-3 w-3 mr-1" />
                {procesoCount} Procesos
              </Badge>
              {phaseFilter !== 'ALL' && (
                <Button variant="ghost" size="sm" onClick={() => setPhaseFilter('ALL')} className="h-6 px-2">
                  <Filter className="h-3 w-3 mr-1" /> Mostrar todo
                </Button>
              )}
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
        <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            Etapas 1-3: RADICACIÓN
          </span>
          <span className="text-muted-foreground/50">→</span>
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            Etapas 4-13: PROCESO
          </span>
          <span className="text-muted-foreground/30 mx-2">|</span>
          <span className="italic">Arrastra tarjetas para cambiar etapa. La fase se actualiza automáticamente.</span>
        </div>

        {/* Pipeline columns */}
        <ScrollArea className="pb-4">
          <div className="flex gap-3 min-h-[500px]">
            {visibleStages.map((stage) => (
              <WorkItemPipelineColumn
                key={stage.key}
                stage={toColumnStageConfig(stage)}
                items={itemsByStage[stage.key] || []}
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
