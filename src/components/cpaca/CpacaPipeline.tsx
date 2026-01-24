/**
 * CpacaPipeline - CPACA Kanban pipeline with full feature parity with CGP
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'CPACA'
 * - Uses UnifiedKanbanBoard for consistent DnD behavior (same as CGP)
 * - Stages correspond to CPACA phases
 * - Includes drag-drop, bulk selection, keyboard navigation
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Keyboard, CheckSquare, Plus, Landmark, Filter, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "@/components/pipeline/WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "@/components/pipeline/WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "@/components/pipeline/WorkItemBulkDeleteDialog";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
import { NewCpacaDialog } from "./NewCpacaDialog";
import {
  CPACA_PHASES,
  CPACA_PHASES_ORDER,
  type CpacaPhase,
} from "@/lib/cpaca-constants";

// Default phase for items without a valid phase
const DEFAULT_CPACA_PHASE: CpacaPhase = "PRECONTENCIOSO";

// Convert CPACA phase config to Kanban stage format
function toKanbanStage(phase: CpacaPhase): KanbanStage {
  const config = CPACA_PHASES[phase];
  return {
    id: phase,
    label: config.label,
    shortLabel: config.label,
    color: config.color,
    description: config.description,
    phase: phase,
  };
}

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["cpaca-work-items-pipeline"],
  ["work-items"],
  ["work-items-list"],
  ["dashboard-stats"],
  ["dashboard"],
  ["cpaca-processes"],
];

export function CpacaPipeline() {
  const queryClient = useQueryClient();
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [singleDeleteItem, setSingleDeleteItem] = useState<WorkItemPipelineItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState<'ALL' | CpacaPhase>('ALL');

  // Use secure delete hook
  const { deleteSingle, isDeleting: isSingleDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSingleDeleteItem(null);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  });

  // Get all CPACA phases as Kanban stages
  const allStages = useMemo(() => 
    CPACA_PHASES_ORDER.map(toKanbanStage), 
    []
  );

  // Filter stages by phase if filter is active
  const visibleStages = useMemo(() => {
    if (phaseFilter === 'ALL') return allStages;
    return allStages.filter(s => s.id === phaseFilter);
  }, [allStages, phaseFilter]);

  // Fetch work_items for CPACA workflow
  const { data: workItems, isLoading, refetch, error } = useQuery({
    queryKey: ["cpaca-work-items-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      // RLS handles user scoping via owner_id
      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id, workflow_type, stage, status,
          radicado, title, authority_name, authority_city, demandantes, demandados,
          is_flagged, last_action_date, last_checked_at, monitoring_enabled,
          auto_admisorio_date, created_at,
          client_id, clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("workflow_type", "CPACA")
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .is("deleted_at", null); // Exclude soft-deleted items

      if (error) throw error;
      
      return (data || []).map((item): WorkItemPipelineItem => {
        // Map stage to valid CPACA phase, fallback to default
        let stage = item.stage;
        if (!stage || !CPACA_PHASES_ORDER.includes(stage as CpacaPhase)) {
          stage = DEFAULT_CPACA_PHASE;
        }
        
        return {
          id: item.id,
          workflow_type: item.workflow_type as any,
          stage: stage,
          cgp_phase: null, // Not applicable for CPACA
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
   * Stage update mutation - updates work_items.stage to new CPACA phase
   */
  const updateStageMutation = useMutation({
    mutationFn: async ({ itemId, newStage }: { itemId: string; newStage: string }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ 
          stage: newStage, 
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      
      if (error) throw error;
      
      return { itemId, newStage };
    },
    onSuccess: ({ newStage }) => {
      const phaseConfig = CPACA_PHASES[newStage as CpacaPhase];
      toast.success(`Movido a: ${phaseConfig?.label || newStage}`);
      
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
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items-pipeline"] });
    },
    onError: () => toast.error("Error al actualizar bandera"),
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
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setDeleteDialog(false);
      toast.success(`${result?.deleted_count || 0} elemento${result?.deleted_count !== 1 ? "s" : ""} eliminado${result?.deleted_count !== 1 ? "s" : ""}`);
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
  const phaseCounts = useMemo(() => {
    const counts: Partial<Record<CpacaPhase, number>> = {};
    CPACA_PHASES_ORDER.forEach(phase => { counts[phase] = 0; });
    (workItems || []).forEach(item => {
      const phase = item.stage as CpacaPhase;
      if (counts[phase] !== undefined) {
        counts[phase]!++;
      }
    });
    return counts;
  }, [workItems]);

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
            <h2 className="text-xl font-semibold">Pipeline CPACA</h2>
            <p className="text-sm text-muted-foreground">{totalItems} casos activos • {CPACA_PHASES_ORDER.length} fases</p>
          </div>
          {/* Phase summary badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge 
              variant="secondary" 
              className="cursor-pointer bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30"
            >
              <Landmark className="h-3 w-3 mr-1" />
              {totalItems} Total
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
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo CPACA
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {totalItems === 0 && !isLoading && (
        <Alert className="border-indigo-200 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/20">
          <AlertCircle className="h-4 w-4 text-indigo-500" />
          <AlertDescription className="text-indigo-700 dark:text-indigo-300">
            No hay procesos CPACA activos. Importa procesos desde ICARUS o crea uno nuevo.
          </AlertDescription>
        </Alert>
      )}

      {/* Phase explanation */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          Fases del proceso contencioso administrativo
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar de fase.</span>
      </div>

      {/* Unified Kanban Board - same component as CGP */}
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
          workflowType: "CPACA",
        }}
      />

      {/* New CPACA dialog */}
      <NewCpacaDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
    </div>
  );
}
