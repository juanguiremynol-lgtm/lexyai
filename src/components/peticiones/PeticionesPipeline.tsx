/**
 * PeticionesPipeline - Peticiones Kanban pipeline with full feature parity with Tutela/CGP/CPACA
 * 
 * KEY ARCHITECTURE:
 * - Uses UnifiedKanbanBoard for consistent DnD behavior (same as CGP/CPACA/Tutela)
 * - Stages correspond to PETICION_PHASES from peticiones-constants
 * - Includes drag-drop, bulk selection, keyboard navigation
 * - Preserves Peticion-specific features: deadline tracking, escalation to tutela
 */

import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, Keyboard, CheckSquare, FileText, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UnifiedKanbanBoard, type KanbanStage } from "@/components/kanban/UnifiedKanbanBoard";
import { WorkItemBulkActionsBar } from "@/components/pipeline/WorkItemBulkActionsBar";
import { WorkItemBulkDeleteDialog } from "@/components/pipeline/WorkItemBulkDeleteDialog";
import {
  PETICION_PHASES,
  PETICION_PHASES_ORDER,
  type PeticionPhase,
} from "@/lib/peticiones-constants";
import { PeticionCard, PeticionItem } from "./PeticionCard";
import { EscalateToTutelaDialog } from "./EscalateToTutelaDialog";

// Color mapping for peticion stages
const STAGE_COLORS: Record<PeticionPhase, string> = {
  PETICION_RADICADA: "blue",
  CONSTANCIA_RADICACION: "amber",
  RESPUESTA: "emerald",
};

// Convert peticion phase to Kanban stage format
function toKanbanStage(phase: PeticionPhase): KanbanStage {
  const config = PETICION_PHASES[phase];
  return {
    id: phase,
    label: config.label,
    shortLabel: config.shortLabel,
    color: STAGE_COLORS[phase] || "blue",
    description: config.description,
    phase,
  };
}

// Extend PeticionItem with stage field for KanbanItem compatibility
interface PeticionKanbanItem extends PeticionItem {
  stage: string;
}

// Query keys for global invalidation
const INVALIDATE_QUERIES = [
  ["peticiones"],
  ["dashboard-stats"],
  ["dashboard"],
];

interface RawPeticion {
  id: string;
  entity_name: string;
  entity_type: "PUBLIC" | "PRIVATE";
  subject: string;
  radicado: string | null;
  filed_at: string | null;
  deadline_at: string | null;
  prorogation_requested: boolean | null;
  prorogation_deadline_at: string | null;
  phase: PeticionPhase;
  escalated_to_tutela: boolean | null;
  tutela_filing_id: string | null;
  client_id: string | null;
  is_flagged: boolean | null;
  clients: { id: string; name: string } | null;
}

function rawToPeticionKanbanItem(raw: RawPeticion): PeticionKanbanItem {
  return {
    id: raw.id,
    stage: raw.phase, // Map phase → stage for UnifiedKanbanBoard
    entityName: raw.entity_name,
    entityType: raw.entity_type,
    subject: raw.subject,
    radicado: raw.radicado,
    filedAt: raw.filed_at,
    deadlineAt: raw.deadline_at,
    prorogationRequested: raw.prorogation_requested ?? false,
    prorogationDeadlineAt: raw.prorogation_deadline_at,
    phase: raw.phase,
    escalatedToTutela: raw.escalated_to_tutela ?? false,
    tutelaFilingId: raw.tutela_filing_id,
    clientId: raw.client_id,
    clientName: raw.clients?.name || null,
    isFlagged: raw.is_flagged ?? false,
  };
}

export function PeticionesPipeline() {
  const queryClient = useQueryClient();
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isKeyboardMode, setIsKeyboardMode] = useState(false);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [escalateDialog, setEscalateDialog] = useState<{
    open: boolean;
    peticion: PeticionItem | null;
  }>({ open: false, peticion: null });

  // Get all peticion stages as Kanban stages
  const allStages = useMemo(() =>
    PETICION_PHASES_ORDER.map(toKanbanStage),
    []
  );

  // Fetch peticiones
  const { data: peticiones, isLoading, refetch } = useQuery({
    queryKey: ["peticiones"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("peticiones")
        .select(`
          id, entity_name, entity_type, subject, radicado, filed_at, deadline_at,
          prorogation_requested, prorogation_deadline_at, phase, escalated_to_tutela,
          tutela_filing_id, client_id, is_flagged,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawPeticion[]).map(rawToPeticionKanbanItem);
    },
  });

  // Update phase mutation
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ peticionId, newPhase }: { peticionId: string; newPhase: PeticionPhase }) => {
      const updates: Record<string, unknown> = { phase: newPhase };

      if (newPhase === "CONSTANCIA_RADICACION") {
        updates.constancia_received_at = new Date().toISOString();
      }
      if (newPhase === "RESPUESTA") {
        updates.response_received_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("peticiones")
        .update(updates)
        .eq("id", peticionId);

      if (error) throw error;
      return { peticionId, newPhase };
    },
    onSuccess: ({ newPhase }) => {
      const stageConfig = PETICION_PHASES[newPhase];
      toast.success(`Movido a: ${stageConfig?.label || newPhase}`);
      INVALIDATE_QUERIES.forEach(queryKey => {
        queryClient.invalidateQueries({ queryKey });
      });
    },
    onError: () => toast.error("Error al actualizar estado"),
  });

  // Toggle flag mutation
  const toggleFlagMutation = useMutation({
    mutationFn: async (item: PeticionKanbanItem) => {
      const { error } = await supabase
        .from("peticiones")
        .update({ is_flagged: !item.isFlagged })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
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
      toast.success(`${result?.deleted_count || 0} peticion${result?.deleted_count !== 1 ? "es" : ""} eliminada${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al eliminar peticiones"),
  });

  // Handle stage drop from Kanban
  const handleStageDrop = useCallback(async (
    itemId: string,
    newStageId: string,
    _item: PeticionKanbanItem
  ) => {
    await updatePhaseMutation.mutateAsync({ peticionId: itemId, newPhase: newStageId as PeticionPhase });
  }, [updatePhaseMutation]);

  // Selection handlers
  const toggleSelectionMode = () => {
    if (isSelectionMode) {
      setSelectedIds(new Set());
    }
    setIsSelectionMode(!isSelectionMode);
  };

  const toggleItemSelection = useCallback((item: PeticionKanbanItem, shiftKey: boolean) => {
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
    setSelectedIds(new Set((peticiones || []).map(i => i.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Sort items: flagged first, then by deadline
  const sortItems = useCallback((a: PeticionKanbanItem, b: PeticionKanbanItem) => {
    if (a.isFlagged && !b.isFlagged) return -1;
    if (!a.isFlagged && b.isFlagged) return 1;
    const dateA = a.deadlineAt ? new Date(a.deadlineAt).getTime() : Infinity;
    const dateB = b.deadlineAt ? new Date(b.deadlineAt).getTime() : Infinity;
    return dateA - dateB; // Urgent (closer deadline) first
  }, []);

  // Render card function for Kanban
  const renderCard = useCallback((
    item: PeticionKanbanItem,
    options: { isDragging?: boolean; isFocused?: boolean; isSelected?: boolean; isSelectionMode?: boolean }
  ) => (
    <PeticionCard
      item={item}
      isDragging={options.isDragging}
      isFocused={options.isFocused}
      isSelected={options.isSelected}
      isSelectionMode={options.isSelectionMode}
      onToggleSelection={(petItem, shiftKey) => toggleItemSelection(item, shiftKey)}
      onEscalateToTutela={(peticion) => setEscalateDialog({ open: true, peticion })}
      onToggleFlag={() => toggleFlagMutation.mutate(item)}
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
          {PETICION_PHASES_ORDER.map((_, i) => (
            <Skeleton key={i} className="h-[500px] min-w-[280px]" />
          ))}
        </div>
      </div>
    );
  }

  const totalItems = peticiones?.length || 0;

  return (
    <div className="space-y-4">
      {/* Header — aligned with Tutela/CGP/CPACA */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold">Pipeline Peticiones</h2>
            <p className="text-sm text-muted-foreground">{totalItems} peticiones activas • {PETICION_PHASES_ORDER.length} fases</p>
          </div>
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30"
          >
            <FileText className="h-3 w-3 mr-1" />
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
        <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-500" />
          <AlertDescription className="text-blue-700 dark:text-blue-300">
            No hay peticiones activas. Crea una nueva petición desde el botón "+".
          </AlertDescription>
        </Alert>
      )}

      {/* Phase explanation */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 px-2 flex-wrap">
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          Fases del derecho de petición
        </span>
        <span className="text-muted-foreground/30 mx-2">|</span>
        <span className="italic">Arrastra tarjetas para cambiar de fase. Las peticiones vencidas pueden escalarse a tutela.</span>
      </div>

      {/* Unified Kanban Board — same component as CGP/CPACA/Tutela */}
      <UnifiedKanbanBoard<PeticionKanbanItem, KanbanStage>
        stages={allStages}
        items={peticiones || []}
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

      {/* Escalate to tutela dialog */}
      <EscalateToTutelaDialog
        open={escalateDialog.open}
        onOpenChange={(open) => setEscalateDialog(prev => ({ ...prev, open }))}
        peticion={escalateDialog.peticion}
      />
    </div>
  );
}
