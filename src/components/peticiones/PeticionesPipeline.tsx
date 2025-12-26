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
import { FileText, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { addBusinessDays } from "@/lib/colombian-holidays";
import {
  PETICION_PHASES,
  PETICION_PHASES_ORDER,
  PETICION_DEADLINE_DAYS,
  PETICION_PROROGATION_DAYS,
  type PeticionPhase,
} from "@/lib/peticiones-constants";
import { PeticionColumn, PeticionStageConfig } from "./PeticionColumn";
import { PeticionCard, PeticionItem } from "./PeticionCard";
import { NewPeticionDialog } from "./NewPeticionDialog";
import { EscalateToTutelaDialog } from "./EscalateToTutelaDialog";
import { PeticionesBulkActionsBar } from "./PeticionesBulkActionsBar";
import { PeticionesBulkDeleteDialog } from "./PeticionesBulkDeleteDialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";

// Build stages configuration
const PETICION_STAGES: PeticionStageConfig[] = PETICION_PHASES_ORDER.map((phase) => ({
  id: `peticion:${phase}`,
  label: PETICION_PHASES[phase].label,
  shortLabel: PETICION_PHASES[phase].shortLabel,
  color: PETICION_PHASES[phase].color,
  phase,
}));

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
  clients: { id: string; name: string } | null;
}

function rawToPeticionItem(raw: RawPeticion): PeticionItem {
  return {
    id: raw.id,
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
  };
}

export function PeticionesPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<PeticionItem | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [escalateDialog, setEscalateDialog] = useState<{
    open: boolean;
    peticion: PeticionItem | null;
  }>({ open: false, peticion: null });
  const [deleteDialog, setDeleteDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch peticiones
  const { data: peticiones, isLoading } = useQuery({
    queryKey: ["peticiones"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("peticiones")
        .select(`
          id, entity_name, entity_type, subject, radicado, filed_at, deadline_at,
          prorogation_requested, prorogation_deadline_at, phase, escalated_to_tutela,
          tutela_filing_id, client_id,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawPeticion[]).map(rawToPeticionItem);
    },
  });

  // Update phase mutation
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ peticionId, newPhase }: { peticionId: string; newPhase: PeticionPhase }) => {
      const updates: Record<string, unknown> = { phase: newPhase };

      // If moving to CONSTANCIA_RADICACION, set constancia_received_at
      if (newPhase === "CONSTANCIA_RADICACION") {
        updates.constancia_received_at = new Date().toISOString();
      }
      
      // If moving to RESPUESTA, set response_received_at
      if (newPhase === "RESPUESTA") {
        updates.response_received_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("peticiones")
        .update(updates)
        .eq("id", peticionId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      toast.success("Estado actualizado");
    },
    onError: () => toast.error("Error al actualizar estado"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Delete related alerts first
      await supabase.from("peticion_alerts").delete().in("peticion_id", ids);
      
      // Delete peticiones
      const { error } = await supabase.from("peticiones").delete().in("id", ids);
      if (error) throw error;
      
      return ids;
    },
    onSuccess: (ids) => {
      queryClient.invalidateQueries({ queryKey: ["peticiones"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${ids.length} peticion${ids.length !== 1 ? "es" : ""} eliminada${ids.length !== 1 ? "s" : ""}`);
    },
    onError: () => {
      toast.error("Error al eliminar peticiones");
    },
  });

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const [, id] = itemId.split(":");
    const item = peticiones?.find(p => p.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const activeId = active.id as string;
    const [, itemId] = activeId.split(":");
    const [, targetPhase] = (over.id as string).split(":");

    const item = peticiones?.find(p => p.id === itemId);
    if (!item) return;

    if (item.phase !== targetPhase) {
      updatePhaseMutation.mutate({ peticionId: itemId, newPhase: targetPhase as PeticionPhase });
    }
  }, [peticiones, updatePhaseMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Group items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, PeticionItem[]> = {};
    PETICION_STAGES.forEach(stage => {
      result[stage.id] = [];
    });

    peticiones?.forEach(item => {
      const stageId = `peticion:${item.phase}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        // Fallback to first stage
        result[PETICION_STAGES[0].id].push(item);
      }
    });

    return result;
  }, [peticiones]);

  // Flatten items for batch selection
  const allItemsFlat = useMemo(() => {
    const items: { id: string; type: "peticion" }[] = [];
    PETICION_STAGES.forEach(stage => {
      itemsByStage[stage.id]?.forEach(item => {
        items.push({ id: item.id, type: "peticion" as const });
      });
    });
    return items;
  }, [itemsByStage]);

  // Batch selection - now supports peticion type natively
  const {
    isSelectionMode,
    toggleSelection,
    isSelected,
    selectAll,
    clearSelection,
    getSelectedItems,
    selectedCount,
  } = useBatchSelection({ allItems: allItemsFlat });

  // Wrapper to adapt selection
  const isItemSelected = useCallback((item: { id: string; type: "peticion" }) => {
    return isSelected(item);
  }, [isSelected]);

  const toggleItemSelection = useCallback((item: { id: string; type: "peticion" }, shiftKey: boolean) => {
    toggleSelection(item, shiftKey);
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
        {PETICION_STAGES.map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const totalPeticiones = peticiones?.length || 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Pipeline Peticiones</h2>
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 px-3 py-1">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            {totalPeticiones} Peticion{totalPeticiones !== 1 ? "es" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={isSelectionMode}
              onChange={toggleSelectionMode}
              className="rounded border-muted-foreground/50"
            />
            <CheckSquare className="h-4 w-4" />
            Selección
          </label>
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
            {PETICION_STAGES.map((stage) => (
              <PeticionColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                isSelectionMode={isSelectionMode}
                isItemSelected={isItemSelected}
                onToggleSelection={toggleItemSelection}
                onEscalateToTutela={(peticion) => setEscalateDialog({ open: true, peticion })}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? <PeticionCard item={activeItem} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <NewPeticionDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />
      
      <EscalateToTutelaDialog
        open={escalateDialog.open}
        onOpenChange={(open) => setEscalateDialog(prev => ({ ...prev, open }))}
        peticion={escalateDialog.peticion}
      />

      <PeticionesBulkActionsBar
        selectedCount={selectedCount}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={() => setDeleteDialog(true)}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <PeticionesBulkDeleteDialog
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
