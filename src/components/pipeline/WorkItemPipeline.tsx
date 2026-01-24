/**
 * WorkItemPipeline - CGP Kanban pipeline with 12 stages
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'CGP'
 * - Phase (RADICACIÓN/PROCESO) is DERIVED from stage automatically
 * - Stages 1-3 = RADICACIÓN, Stages 4-12 = PROCESO
 * - Uses unified Kanban engine for consistent DnD behavior
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Keyboard, CheckSquare, FileText, Scale, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
import {
  CGP_STAGES,
  derivePhaseFromStage,
  getOrderedCGPStages,
  mapLegacyStage,
  type CGPPhase,
  type CGPStageConfig,
} from "@/lib/cgp-stages";

// Convert CGP stage config to Kanban stage format
function toKanbanStage(stage: CGPStageConfig): KanbanStage {
  return {
    id: stage.key,
    label: stage.label,
    shortLabel: stage.shortLabel,
    color: stage.color,
    description: stage.description,
    phase: stage.phase,
  };
}

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["work-items-cgp-pipeline"],
  ["work-items"],
  ["dashboard-stats"],
  ["cgp-items"],
  ["work-item-mappings"],
  ["monitored-processes"],
];

export function WorkItemPipeline() {
  const queryClient = useQueryClient();
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [singleDeleteItem, setSingleDeleteItem] = useState<WorkItemPipelineItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | 'RADICACION' | 'PROCESO'>('ALL');

  // Use secure delete hook
  const { deleteSingle, isDeleting: isSingleDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSingleDeleteItem(null);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  });

  // Get all 12 CGP stages as Kanban stages
  const allStages = useMemo(() => 
    getOrderedCGPStages().map(toKanbanStage), 
    []
  );

  // Filter stages by phase if filter is active
  const visibleStages = useMemo(() => {
    if (phaseFilter === 'ALL') return allStages;
    return allStages.filter(s => s.phase === phaseFilter);
  }, [allStages, phaseFilter]);

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
      
      return (data || []).map((item): WorkItemPipelineItem => {
        // Map legacy stage names to new 12-stage system
        const normalizedStage = mapLegacyStage(item.stage);
        
        return {
          id: item.id,
          workflow_type: item.workflow_type as any,
          stage: normalizedStage,
          cgp_phase: derivePhaseFromStage(normalizedStage), // Always derive from stage
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
        };
      });
    },
  });

  /**
   * CRITICAL MUTATION: Atomic stage + phase update
   * Phase is ALWAYS derived from stage - never set independently
   */
  const updateStageMutation = useMutation({
    mutationFn: async ({ itemId, newStage }: { itemId: string; newStage: string }) => {
      // Derive phase deterministically from the new stage
      const newPhase = derivePhaseFromStage(newStage);
      
      // Map phase to DB-compatible values
      const dbPhase = newPhase === 'RADICACION' ? 'FILING' : 'PROCESS';
      
      const { error } = await supabase
        .from("work_items")
        .update({ 
          stage: newStage, 
          cgp_phase: dbPhase,
          cgp_phase_source: "MANUAL",
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      
      if (error) throw error;
      
      return { itemId, newStage, newPhase };
    },
    onSuccess: ({ newStage }) => {
      const stageConfig = CGP_STAGES[newStage];
      toast.success(`Movido a: ${stageConfig?.shortLabel || newStage}`);
      
      // Invalidate all related queries for global consistency
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: (error) => {
      console.error("Error updating stage:", error);
      toast.error("Error al actualizar etapa");
    },
  });

  // Handle stage drop from Kanban
  const handleStageDrop = useCallback(async (
    itemId: string, 
    newStageId: string, 
    item: WorkItemPipelineItem
  ) => {
    await updateStageMutation.mutateAsync({
      itemId,
      newStage: newStageId,
    });
  }, [updateStageMutation]);

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
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setDeleteDialog(false);
      toast.success(`${ids.length} elemento${ids.length !== 1 ? "s" : ""} eliminado${ids.length !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al eliminar elementos"),
  });

  // Selection handlers
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds(new Set());
    }
    setIsSelectionMode(!isSelectionMode);
  };

  const toggleItemSelection = useCallback((item: WorkItemPipelineItem, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(item.id)) {
        newSet.delete(item.id);
      } else {
        newSet.add(item.id);
      }
      return newSet;
    });
  }, []);

  const selectAll = () => {
    setSelectedIds(new Set((workItems || []).map(i => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Sort items: flagged first, then by last action date
  const sortItems = useCallback((a: WorkItemPipelineItem, b: WorkItemPipelineItem) => {
    if (a.is_flagged && !b.is_flagged) return -1;
    if (!a.is_flagged && b.is_flagged) return 1;
    const dateA = a.last_action_date ? new Date(a.last_action_date).getTime() : 0;
    const dateB = b.last_action_date ? new Date(b.last_action_date).getTime() : 0;
    return dateB - dateA;
  }, []);

  // Calculate counts by phase
  const radicacionCount = useMemo(() => 
    (workItems || []).filter(i => derivePhaseFromStage(i.stage) === 'RADICACION').length, 
    [workItems]
  );
  const procesoCount = useMemo(() => 
    (workItems || []).filter(i => derivePhaseFromStage(i.stage) === 'PROCESO').length, 
    [workItems]
  );

  // Render card function for Kanban
  const renderCard = useCallback((
    item: WorkItemPipelineItem, 
    options: { isDragging?: boolean; isFocused?: boolean; isSelected?: boolean; isSelectionMode?: boolean }
  ) => (
    <WorkItemPipelineCard
      item={item}
      isDragging={options.isDragging}
      isFocused={options.isFocused}
      isSelected={options.isSelected}
      isSelectionMode={options.isSelectionMode}
      onToggleSelection={toggleItemSelection}
      onToggleFlag={(item) => toggleFlagMutation.mutate(item)}
      onDelete={(item) => setSingleDeleteItem(item)}
    />
  ), [toggleItemSelection, toggleFlagMutation]);

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
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-[500px] min-w-[280px]" />
          ))}
        </div>
      </div>
    );
  }

  const totalItems = workItems?.length || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold">Pipeline CGP</h2>
            <p className="text-sm text-muted-foreground">{totalItems} casos activos • 12 etapas</p>
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
          Etapas 4-12: PROCESO
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar etapa. La fase se actualiza automáticamente.</span>
      </div>

      {/* Unified Kanban Board */}
      <UnifiedKanbanBoard<WorkItemPipelineItem, KanbanStage>
        stages={visibleStages}
        items={workItems || []}
        isLoading={isLoading}
        onStageDrop={handleStageDrop}
        renderCard={renderCard}
        invalidateQueries={INVALIDATE_QUERIES}
        minColumnHeight="500px"
        sortItems={sortItems}
        isSelectionMode={isSelectionMode}
        selectedIds={selectedIds}
        focusedItemId={focusedItemId}
        onToggleSelection={toggleItemSelection}
      />

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

      {/* Single delete dialog */}
      <DeleteWorkItemDialog
        open={!!singleDeleteItem}
        onOpenChange={(open) => !open && setSingleDeleteItem(null)}
        onConfirm={() => singleDeleteItem && deleteSingle(singleDeleteItem.id)}
        isDeleting={isSingleDeleting}
        itemInfo={{
          title: singleDeleteItem?.title,
          radicado: singleDeleteItem?.radicado,
          workflowType: "CGP",
        }}
      />
    </div>
  );
}
