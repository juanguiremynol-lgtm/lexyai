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
import { Gavel, Plus, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  TUTELA_PHASES,
  TUTELA_PHASES_ORDER,
  TUTELA_FINAL_PHASES,
  type TutelaPhase,
} from "@/lib/tutela-constants";
import { TutelaColumn, TutelaStageConfig } from "./TutelaColumn";
import { TutelaCard, TutelaItem } from "./TutelaCard";
import { NewTutelaDialog } from "./NewTutelaDialog";
import { FalloOutcomeDialog } from "./FalloOutcomeDialog";
import { ArchivePromptDialog } from "./ArchivePromptDialog";
import { TutelasBulkActionsBar } from "./TutelasBulkActionsBar";
import { TutelasBulkDeleteDialog } from "./TutelasBulkDeleteDialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";

// Map filing status to tutela phase
function statusToPhase(status: string): TutelaPhase {
  switch (status) {
    case "DRAFTED":
    case "SENT_TO_REPARTO":
    case "RECEIPT_CONFIRMED":
    case "ACTA_PENDING":
      return "TUTELA_RADICADA";
    case "ACTA_RECEIVED_PARSED":
    case "COURT_EMAIL_DRAFTED":
    case "COURT_EMAIL_SENT":
    case "RADICADO_PENDING":
    case "RADICADO_CONFIRMED":
    case "ICARUS_SYNC_PENDING":
      return "TUTELA_ADMITIDA";
    case "MONITORING_ACTIVE":
      return "FALLO_PRIMERA_INSTANCIA";
    case "CLOSED":
      return "FALLO_SEGUNDA_INSTANCIA";
    default:
      return "TUTELA_RADICADA";
  }
}

// Map tutela phase back to filing status
function phaseToStatus(phase: TutelaPhase): string {
  switch (phase) {
    case "TUTELA_RADICADA":
      return "DRAFTED";
    case "TUTELA_ADMITIDA":
      return "RADICADO_CONFIRMED";
    case "FALLO_PRIMERA_INSTANCIA":
      return "MONITORING_ACTIVE";
    case "FALLO_SEGUNDA_INSTANCIA":
      return "CLOSED";
    default:
      return "DRAFTED";
  }
}

// Build stages configuration
const TUTELA_STAGES: TutelaStageConfig[] = TUTELA_PHASES_ORDER.map((phase) => ({
  id: `tutela:${phase}`,
  label: TUTELA_PHASES[phase].label,
  shortLabel: TUTELA_PHASES[phase].shortLabel,
  color: TUTELA_PHASES[phase].color,
  phase,
}));

interface RawTutela {
  id: string;
  filing_type: string;
  radicado: string | null;
  court_name: string | null;
  created_at: string;
  status: string;
  has_auto_admisorio: boolean | null;
  demandantes: string | null;
  demandados: string | null;
  last_reviewed_at: string | null;
  client_id: string | null;
  clients: { id: string; name: string } | null;
}

function rawToTutelaItem(raw: RawTutela): TutelaItem {
  return {
    id: raw.id,
    filingType: raw.filing_type,
    radicado: raw.radicado,
    courtName: raw.court_name,
    createdAt: raw.created_at,
    status: raw.status,
    phase: statusToPhase(raw.status),
    clientName: raw.clients?.name || null,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    lastArchivedPromptAt: raw.last_reviewed_at,
    isFavorable: raw.has_auto_admisorio,
  };
}

export function TutelasPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<TutelaItem | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch tutelas (filings with type TUTELA)
  const { data: tutelas, isLoading } = useQuery({
    queryKey: ["tutelas"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("filings")
        .select(`
          id, filing_type, radicado, court_name, created_at, status,
          has_auto_admisorio, demandantes, demandados, last_reviewed_at,
          client_id,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("filing_type", "TUTELA")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawTutela[]).map(rawToTutelaItem);
    },
  });

  // Update phase mutation
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ tutelaId, newPhase }: { tutelaId: string; newPhase: TutelaPhase }) => {
      const newStatus = phaseToStatus(newPhase) as "DRAFTED" | "RADICADO_CONFIRMED" | "MONITORING_ACTIVE" | "CLOSED";
      
      const { error } = await supabase
        .from("filings")
        .update({ status: newStatus })
        .eq("id", tutelaId);
      
      if (error) throw error;
      return { tutelaId, newPhase };
    },
    onSuccess: ({ newPhase }) => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      toast.success("Estado actualizado");
      
      // If moving to a fallo phase, open the outcome dialog
      if (newPhase === "FALLO_PRIMERA_INSTANCIA" || newPhase === "FALLO_SEGUNDA_INSTANCIA") {
        const tutela = tutelas?.find(t => t.phase === newPhase);
        if (tutela) {
          setFalloDialog({ open: true, tutela, targetPhase: newPhase });
        }
      }
    },
    onError: () => toast.error("Error al actualizar estado"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        // Delete related data
        await supabase.from("documents").delete().eq("filing_id", id);
        await supabase.from("hearings").delete().eq("filing_id", id);
        await supabase.from("emails").delete().eq("filing_id", id);
        await supabase.from("process_events").delete().eq("filing_id", id);
        await supabase.from("tasks").delete().eq("filing_id", id);
        await supabase.from("alerts").delete().eq("filing_id", id);
      }
      
      // Delete filings
      const { error } = await supabase.from("filings").delete().in("id", ids);
      if (error) throw error;
      
      return ids;
    },
    onSuccess: (ids) => {
      queryClient.invalidateQueries({ queryKey: ["tutelas"] });
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${ids.length} tutela${ids.length !== 1 ? "s" : ""} eliminada${ids.length !== 1 ? "s" : ""}`);
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
    const [, targetPhase] = (over.id as string).split(":");

    const item = tutelas?.find(t => t.id === itemId);
    if (!item) return;

    if (item.phase !== targetPhase) {
      // If moving to a fallo phase, we need to ask about the outcome first
      if (targetPhase === "FALLO_PRIMERA_INSTANCIA" || targetPhase === "FALLO_SEGUNDA_INSTANCIA") {
        setFalloDialog({ open: true, tutela: item, targetPhase: targetPhase as TutelaPhase });
      } else {
        updatePhaseMutation.mutate({ tutelaId: itemId, newPhase: targetPhase as TutelaPhase });
      }
    }
  }, [tutelas, updatePhaseMutation]);

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

  // Group items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, TutelaItem[]> = {};
    TUTELA_STAGES.forEach(stage => {
      result[stage.id] = [];
    });

    tutelas?.forEach(item => {
      const stageId = `tutela:${item.phase}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        // Fallback to first stage
        result[TUTELA_STAGES[0].id].push(item);
      }
    });

    return result;
  }, [tutelas]);

  // Flatten items for batch selection
  const allItemsFlat = useMemo(() => {
    const items: { id: string; type: "filing" }[] = [];
    TUTELA_STAGES.forEach(stage => {
      itemsByStage[stage.id]?.forEach(item => {
        items.push({ id: item.id, type: "filing" });
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
    return isSelected({ id: item.id, type: "filing" });
  }, [isSelected]);

  const toggleItemSelection = useCallback((item: { id: string; type: "tutela" }, shiftKey: boolean) => {
    toggleSelection({ id: item.id, type: "filing" }, shiftKey);
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

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {TUTELA_STAGES.map((_, i) => (
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
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectionMode}
            className={isSelectionMode ? "ring-2 ring-primary bg-primary/10" : ""}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            {isSelectionMode ? "Cancelar" : "Seleccionar"}
          </Button>
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
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
            {TUTELA_STAGES.map((stage) => (
              <TutelaColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                isSelectionMode={isSelectionMode}
                isItemSelected={isItemSelected}
                onToggleSelection={toggleItemSelection}
                onArchivePrompt={handleArchivePrompt}
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
    </>
  );
}
