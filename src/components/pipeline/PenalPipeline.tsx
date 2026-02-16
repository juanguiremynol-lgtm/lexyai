/**
 * Penal 906 Pipeline - Kanban board for criminal proceedings under Ley 906 de 2004
 * 
 * Unified with the standard pipeline architecture:
 * - Uses WorkItemPipelineCard for consistent card layout
 * - Includes bulk actions, delete dialogs, selection mode, keyboard nav
 * - Matches LaboralPipeline / CpacaPipeline UX patterns
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSoftDeleteWorkItems } from "@/hooks/use-soft-delete-work-items";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Keyboard, CheckSquare, Shield, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
import { PENAL_906_PHASES, phaseName } from "@/lib/penal906";

// Map PENAL_906_PHASES to KanbanStage format using string keys
const PENAL_STAGES: KanbanStage[] = PENAL_906_PHASES.map((phase) => ({
  id: phase.key,
  label: phase.label,
  shortLabel: phase.shortLabel,
  color: phase.color,
  description: phase.description,
}));

// Map numeric pipeline_stage → string key
function numericToKey(stage: number): string {
  const phase = PENAL_906_PHASES.find((p) => p.id === stage);
  return phase?.key || "PENDIENTE_CLASIFICACION";
}

// Map string key → numeric pipeline_stage
function keyToNumeric(key: string): number {
  const phase = PENAL_906_PHASES.find((p) => p.key === key);
  return phase?.id ?? 0;
}

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["work-items-penal-pipeline"],
  ["work-items"],
  ["dashboard-stats"],
  ["work-item-mappings"],
];

export function PenalPipeline() {
  const queryClient = useQueryClient();
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [singleDeleteItem, setSingleDeleteItem] = useState<WorkItemPipelineItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // Use secure delete hook
  const { deleteSingle, isDeleting: isSingleDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSingleDeleteItem(null);
      INVALIDATE_QUERIES.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  });

  // Fetch PENAL_906 work items
  const { data: workItems, isLoading, refetch } = useQuery({
    queryKey: ["work-items-penal-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id, workflow_type, stage, pipeline_stage, cgp_phase, status,
          radicado, title, authority_name, demandantes, demandados,
          is_flagged, last_action_date, last_checked_at, monitoring_enabled,
          auto_admisorio_date, created_at,
          client_id, clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("workflow_type", "PENAL_906" as any)
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .is("deleted_at", null);

      if (error) throw error;

      return (data || []).map((item): WorkItemPipelineItem => ({
        id: item.id,
        workflow_type: item.workflow_type as any,
        stage: numericToKey(item.pipeline_stage ?? 0),
        cgp_phase: null, // Penal doesn't use phases
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

  // Stage update mutation — converts string key back to numeric pipeline_stage
  const updateStageMutation = useMutation({
    mutationFn: async ({ itemId, newStage }: { itemId: string; newStage: string }) => {
      const numericStage = keyToNumeric(newStage);
      const { error } = await supabase
        .from("work_items")
        .update({
          pipeline_stage: numericStage,
          stage: newStage,
          last_phase_change_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);

      if (error) throw error;
      return { itemId, newStage };
    },
    onSuccess: ({ newStage }) => {
      const numericStage = keyToNumeric(newStage);
      toast.success(`Movido a: ${phaseName(numericStage)}`);
      INVALIDATE_QUERIES.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: (error) => {
      console.error("Error updating stage:", error);
      toast.error("Error al actualizar etapa");
    },
  });

  // Handle stage drop from Kanban
  const handleStageDrop = useCallback(
    async (itemId: string, newStageId: string) => {
      await updateStageMutation.mutateAsync({ itemId, newStage: newStageId });
    },
    [updateStageMutation]
  );

  // Toggle flag mutation
  const toggleFlagMutation = useMutation({
    mutationFn: async (item: WorkItemPipelineItem) => {
      const { error } = await supabase
        .from("work_items")
        .update({ is_flagged: !item.is_flagged })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items-penal-pipeline"] });
    },
    onError: () => toast.error("Error al actualizar bandera"),
  });

  // Bulk soft-delete (hard-delete is disabled via RLS)
  const { archiveBulk, isArchiving: isBulkDeleting } = useSoftDeleteWorkItems({
    onSuccess: () => {
      INVALIDATE_QUERIES.forEach((queryKey) => {
        queryClient.invalidateQueries({ queryKey });
      });
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setDeleteDialog(false);
    },
  });

  // Selection handlers
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds(new Set());
    }
    setIsSelectionMode(!isSelectionMode);
  };

  const toggleItemSelection = useCallback((item: WorkItemPipelineItem, shiftKey: boolean) => {
    setSelectedIds((prev) => {
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
    setSelectedIds(new Set((workItems || []).map((i) => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Sort: flagged first, then by last action date
  const sortItems = useCallback((a: WorkItemPipelineItem, b: WorkItemPipelineItem) => {
    if (a.is_flagged && !b.is_flagged) return -1;
    if (!a.is_flagged && b.is_flagged) return 1;
    const dateA = a.last_action_date ? new Date(a.last_action_date).getTime() : 0;
    const dateB = b.last_action_date ? new Date(b.last_action_date).getTime() : 0;
    return dateB - dateA;
  }, []);

  // Render card using shared component
  const renderCard = useCallback(
    (
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
    ),
    [toggleItemSelection, toggleFlagMutation]
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
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-600" />
              Pipeline Penal (Ley 906)
            </h2>
            <p className="text-sm text-muted-foreground">
              {totalItems} caso{totalItems !== 1 ? "s" : ""} activo{totalItems !== 1 ? "s" : ""} • 14 etapas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} title="Actualizar">
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

      {/* Empty state */}
      {totalItems === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No hay procesos penales activos. Los procesos penales se pueden importar desde ICARUS 
            o crear manualmente usando el botón + en el Dashboard. Los casos con juzgados penales 
            se clasifican automáticamente bajo Ley 906 de 2004.
          </AlertDescription>
        </Alert>
      )}

      {/* Stage legend */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          Fases 0-2: Investigación
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-orange-500" />
          Fases 3-5: Acusación y Preparatoria
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Fases 6-8: Juicio Oral y Sentencia
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          Fases 9+: Recursos y Terminal
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar etapa.</span>
      </div>

      {/* Unified Kanban Board */}
      <UnifiedKanbanBoard<WorkItemPipelineItem, KanbanStage>
        stages={PENAL_STAGES}
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

      {/* Bulk actions bar */}
      {isSelectionMode && selectedIds.size > 0 && (
        <WorkItemBulkActionsBar
          selectedCount={selectedIds.size}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onBulkDelete={() => setDeleteDialog(true)}
          isDeleting={isBulkDeleting}
        />
      )}

      <WorkItemBulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        selectedCount={selectedIds.size}
        onConfirm={() => archiveBulk(Array.from(selectedIds))}
        isDeleting={isBulkDeleting}
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
          workflowType: "PENAL_906",
        }}
      />
    </div>
  );
}
