/**
 * AdminPipeline - GOV_PROCEDURE Kanban pipeline
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'GOV_PROCEDURE'
 * - Uses unified Kanban engine (UnifiedKanbanBoard) for consistent DnD behavior
 * - Uses WorkItemPipelineCard for card consistency across all pipelines
 * - Identical UX to CGP, CPACA, Laboral, Penal, and Tutelas pipelines
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Keyboard, CheckSquare, Building2, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "./WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "./WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "./WorkItemBulkDeleteDialog";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
import {
  GOV_PROCEDURE_STAGES,
  getStageOrderForWorkflow,
  type GovProcedureStage,
} from "@/lib/workflow-constants";

// Column colors for Gov Procedure stages
const STAGE_COLORS: Record<string, string> = {
  INICIO_APERTURA: "orange",
  REQUERIMIENTOS_TRASLADOS: "amber",
  DESCARGOS: "yellow",
  PRUEBAS: "lime",
  ALEGATOS_INFORME: "green",
  DECISION_PRIMERA: "emerald",
  RECURSOS: "teal",
  EJECUCION_CUMPLIMIENTO: "cyan",
  ARCHIVADO: "slate",
};

// Build admin stages as KanbanStage format
const ADMIN_KANBAN_STAGES: KanbanStage[] = getStageOrderForWorkflow("GOV_PROCEDURE").map((stageKey) => {
  const stageConfig = GOV_PROCEDURE_STAGES[stageKey as GovProcedureStage];
  return {
    id: stageKey,
    label: stageConfig.label,
    shortLabel: stageConfig.label.length > 14 ? stageConfig.label.substring(0, 12) + "…" : stageConfig.label,
    color: STAGE_COLORS[stageKey] || "slate",
  };
});

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["gov-procedure-work-items"],
  ["work-items"],
  ["work-items-list"],
  ["dashboard-stats"],
  ["work-item-mappings"],
];

export function AdminPipeline() {
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
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  });

  // Fetch GOV_PROCEDURE work items
  const { data: workItems, isLoading, refetch } = useQuery({
    queryKey: ["gov-procedure-work-items"],
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
        .eq("workflow_type", "GOV_PROCEDURE")
        .is("deleted_at", null)
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((item): WorkItemPipelineItem => ({
        id: item.id,
        workflow_type: item.workflow_type as any,
        stage: item.stage || "INICIO_APERTURA",
        cgp_phase: null, // GOV_PROCEDURE doesn't use CGP phases
        radicado: item.radicado || item.title || "Sin identificador",
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

  // Stage update mutation
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
      const stageConfig = GOV_PROCEDURE_STAGES[newStage as GovProcedureStage];
      toast.success(`Movido a: ${stageConfig?.label || newStage}`);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: () => toast.error("Error al actualizar etapa"),
  });

  // Handle stage drop from Kanban
  const handleStageDrop = useCallback(async (
    itemId: string,
    newStageId: string,
    item: WorkItemPipelineItem
  ) => {
    await updateStageMutation.mutateAsync({ itemId, newStage: newStageId });
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
      queryClient.invalidateQueries({ queryKey: ["gov-procedure-work-items"] });
    },
    onError: () => toast.error("Error al actualizar bandera"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke("delete-work-items", {
        body: { work_item_ids: ids, mode: "SOFT_DELETE" },
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
      toast.success(`${result?.deleted_count || 0} proceso${result?.deleted_count !== 1 ? "s" : ""} archivado${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al archivar elementos"),
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
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Building2 className="h-5 w-5 text-orange-500" />
              Vía Gubernativa / Administrativos
            </h2>
            <p className="text-sm text-muted-foreground">
              {totalItems} proceso{totalItems !== 1 ? "s" : ""} activo{totalItems !== 1 ? "s" : ""} • {ADMIN_KANBAN_STAGES.length} etapas
            </p>
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

      {/* Empty state */}
      {totalItems === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No hay procesos administrativos activos. Puedes crearlos manualmente usando el botón + 
            en el Dashboard o importarlos desde fuentes externas.
          </AlertDescription>
        </Alert>
      )}

      {/* Stage legend */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-orange-500" />
          Inicio / Apertura
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          Trámite / Pruebas
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-teal-500" />
          Decisión / Recursos
        </span>
        <span className="text-muted-foreground/50">→</span>
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-slate-500" />
          Archivado
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar etapa.</span>
      </div>

      {/* Unified Kanban Board */}
      <UnifiedKanbanBoard<WorkItemPipelineItem, KanbanStage>
        stages={ADMIN_KANBAN_STAGES}
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
          workflowType: "GOV_PROCEDURE",
        }}
      />
    </div>
  );
}
