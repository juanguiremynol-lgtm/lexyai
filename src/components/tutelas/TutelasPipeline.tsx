/**
 * TutelasPipeline - Tutela Kanban pipeline with full feature parity with CGP/CPACA
 * 
 * KEY ARCHITECTURE:
 * - Single source of truth: work_items table with workflow_type = 'TUTELA'
 * - Uses UnifiedKanbanBoard for consistent DnD behavior (same as CGP/CPACA)
 * - Stages correspond to TUTELA_STAGES from workflow-constants
 * - Includes drag-drop, bulk selection, keyboard navigation
 * - Preserves Tutela-specific dialogs: Fallo, Desacato, Incumplimiento, Archive
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Keyboard, CheckSquare, Gavel, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemPipelineCard, WorkItemPipelineItem } from "@/components/pipeline/WorkItemPipelineCard";
import { WorkItemBulkActionsBar } from "@/components/pipeline/WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "@/components/pipeline/WorkItemBulkDeleteDialog";
import { DeleteWorkItemDialog } from "@/components/shared/DeleteWorkItemDialog";
import { useDeleteWorkItems } from "@/hooks/use-delete-work-items";
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

import { FalloOutcomeDialog } from "./FalloOutcomeDialog";
import { ArchivePromptDialog } from "./ArchivePromptDialog";
import { InitiateDesacatoDialog } from "./InitiateDesacatoDialog";
import { ReportIncumplimientoDialog } from "./ReportIncumplimientoDialog";
import { DesacatoPipeline } from "./DesacatoPipeline";
import type { TutelaItem } from "./TutelaCard";

// Tutela stage order (excluding ARCHIVADO from Kanban columns)
const TUTELA_STAGES_ORDER: TutelaStage[] = (
  Object.entries(TUTELA_STAGES) as [TutelaStage, { label: string; order: number }][]
)
  .sort((a, b) => a[1].order - b[1].order)
  .filter(([key]) => key !== "ARCHIVADO")
  .map(([key]) => key);

// Color mapping for tutela stages
const STAGE_COLORS: Record<string, string> = {
  TUTELA_RADICADA: "slate",
  TUTELA_ADMITIDA: "blue",
  FALLO_PRIMERA_INSTANCIA: "amber",
  FALLO_SEGUNDA_INSTANCIA: "emerald",
};

// Convert TUTELA stage to Kanban stage format
function toKanbanStage(stage: TutelaStage): KanbanStage {
  const config = TUTELA_STAGES[stage];
  const phase = TUTELA_PHASES[stage as TutelaPhase];
  return {
    id: stage,
    label: config.label,
    shortLabel: phase?.shortLabel || config.label,
    color: STAGE_COLORS[stage] || "slate",
    description: undefined,
    phase: stage,
  };
}

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["tutelas-work-items"],
  ["work-items"],
  ["work-items-list"],
  ["dashboard-stats"],
  ["dashboard"],
];

export function TutelasPipeline() {
  const queryClient = useQueryClient();
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [singleDeleteItem, setSingleDeleteItem] = useState<WorkItemPipelineItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);

  // Tutela-specific dialogs
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
  const [desacatoDialog, setDesacatoDialog] = useState<{
    open: boolean;
    tutela: TutelaItem | null;
  }>({ open: false, tutela: null });
  const [incumplimientoDialog, setIncumplimientoDialog] = useState<{
    open: boolean;
    tutela: TutelaItem | null;
  }>({ open: false, tutela: null });

  // Use secure delete hook
  const { deleteSingle, isDeleting: isSingleDeleting } = useDeleteWorkItems({
    onSuccess: () => {
      setSingleDeleteItem(null);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
  });

  // Get all Tutela stages as Kanban stages
  const allStages = useMemo(() =>
    TUTELA_STAGES_ORDER.map(toKanbanStage),
    []
  );

  // Fetch work_items for TUTELA workflow
  const { data: workItems, isLoading, refetch } = useQuery({
    queryKey: ["tutelas-work-items"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

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
        .eq("workflow_type", "TUTELA")
        .neq("status", "CLOSED")
        .neq("status", "ARCHIVED")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((item): WorkItemPipelineItem => {
        // Map stage to valid tutela stage, fallback to TUTELA_RADICADA
        let stage = item.stage;
        if (!stage || !TUTELA_STAGES_ORDER.includes(stage as TutelaStage)) {
          // Also check ARCHIVADO — if archived, filter was supposed to exclude it
          if (stage === "ARCHIVADO") stage = "FALLO_SEGUNDA_INSTANCIA";
          else stage = "TUTELA_RADICADA";
        }

        return {
          id: item.id,
          workflow_type: item.workflow_type as any,
          stage: stage,
          cgp_phase: null, // Not applicable for Tutela
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
   * Stage update mutation - updates work_items.stage to new tutela stage
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
      const stageConfig = TUTELA_STAGES[newStage as TutelaStage];
      toast.success(`Movido a: ${stageConfig?.label || newStage}`);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: () => {
      toast.error("Error al actualizar etapa");
    },
  });

  // Handle stage drop from Kanban — intercept fallo phases
  const handleStageDrop = useCallback(async (
    itemId: string,
    newStageId: string,
    item: WorkItemPipelineItem
  ) => {
    const isFalloPhase = newStageId === "FALLO_PRIMERA_INSTANCIA" || newStageId === "FALLO_SEGUNDA_INSTANCIA";

    if (isFalloPhase) {
      // Build a TutelaItem stub for the dialog
      const tutelaItem: TutelaItem = {
        id: item.id,
        type: "tutela",
        filingType: "TUTELA",
        radicado: item.radicado,
        courtName: item.authority_name,
        createdAt: item.created_at,
        status: "ACTIVE",
        phase: newStageId as TutelaPhase,
        clientId: item.client_id,
        clientName: item.client_name,
        demandantes: item.demandantes,
        demandados: item.demandados,
        lastArchivedPromptAt: null,
        isFavorable: null,
        isFlagged: item.is_flagged,
        complianceReported: false,
        complianceReportedAt: null,
        hasDesacatoIncident: false,
      };
      setFalloDialog({ open: true, tutela: tutelaItem, targetPhase: newStageId as TutelaPhase });
      // The FalloOutcomeDialog will handle the actual stage update
      return;
    }

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
      queryClient.invalidateQueries({ queryKey: ["tutelas-work-items"] });
    },
    onError: () => toast.error("Error al actualizar bandera"),
  });

  // Bulk delete mutation
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
      toast.success(`${result?.deleted_count || 0} tutela${result?.deleted_count !== 1 ? "s" : ""} eliminada${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al eliminar tutelas"),
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
          {TUTELA_STAGES_ORDER.map((_, i) => (
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
            <h2 className="text-xl font-semibold">Pipeline Tutelas</h2>
            <p className="text-sm text-muted-foreground">{totalItems} tutelas activas • {TUTELA_STAGES_ORDER.length} fases</p>
          </div>
          <Badge
            variant="secondary"
            className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
          >
            <Gavel className="h-3 w-3 mr-1" />
            {totalItems} Total
          </Badge>
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
      {totalItems === 0 && !isLoading && (
        <Alert className="border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-950/20">
          <AlertCircle className="h-4 w-4 text-purple-500" />
          <AlertDescription className="text-purple-700 dark:text-purple-300">
            No hay tutelas activas. Crea una nueva tutela desde el botón "Nueva Tutela".
          </AlertDescription>
        </Alert>
      )}

      {/* Phase explanation */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          Fases del proceso de tutela
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar de fase.</span>
      </div>

      {/* Unified Kanban Board - same component as CGP/CPACA */}
      <UnifiedKanbanBoard<WorkItemPipelineItem, KanbanStage>
        stages={allStages}
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
          workflowType: "TUTELA",
        }}
      />

      {/* Tutela-specific dialogs */}
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
    </div>
  );
}
