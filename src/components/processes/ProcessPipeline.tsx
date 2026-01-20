import { useState, useMemo } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { PROCESS_PHASES_ORDER, type ProcessPhase } from "@/lib/constants";
import { toast } from "sonner";
import { ProcessPipelineColumn } from "./ProcessPipelineColumn";
import { ProcessPipelineCard } from "./ProcessPipelineCard";
import { HearingPromptDialog, HEARING_PHASES } from "@/components/hearings";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { ProcessBulkDeleteDialog } from "./ProcessBulkDeleteDialog";
import { ProcessBulkActionsBar } from "./ProcessBulkActionsBar";
import { RefreshCw, Keyboard, CheckSquare } from "lucide-react";

interface MonitoredProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  phase: ProcessPhase | null;
  linked_filing_id: string | null;
  client_id: string | null;
  clients: { id: string; name: string } | null;
  is_flagged?: boolean;
}

interface ProcessPipelineItem {
  id: string;
  type: "process";
  radicado: string;
}

export function ProcessPipeline() {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);
  const [hearingPrompt, setHearingPrompt] = useState<{
    open: boolean;
    processId: string;
    filingId: string | null;
    radicado: string | null;
    targetPhase: ProcessPhase;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const { data: processes, isLoading, refetch } = useQuery({
    queryKey: ["process-pipeline"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(
          "id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, phase, linked_filing_id, client_id, is_flagged, clients(id, name)"
        )
        .eq("owner_id", user.user.id)
        .eq("monitoring_enabled", true)
        .order("last_change_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as unknown as MonitoredProcess[];
    },
  });

  // Prepare stages for keyboard navigation
  const keyboardStages = useMemo(() => {
    return PROCESS_PHASES_ORDER.map((phase) => ({
      id: phase,
      type: "process" as const,
    }));
  }, []);

  // Prepare items for keyboard navigation and batch selection
  const pipelineItems: ProcessPipelineItem[] = useMemo(() => {
    return (processes || []).map((p) => ({
      id: p.id,
      type: "process" as const,
      radicado: p.radicado,
    }));
  }, [processes]);

  const itemsByStage = useMemo(() => {
    const result: Record<string, ProcessPipelineItem[]> = {};
    PROCESS_PHASES_ORDER.forEach((phase) => {
      result[phase] = [];
    });
    pipelineItems.forEach((item) => {
      const process = processes?.find((p) => p.id === item.id);
      const phase = process?.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
      if (result[phase]) {
        result[phase].push(item);
      }
    });
    return result;
  }, [pipelineItems, processes]);

  // Batch selection
  const {
    selectedIds,
    isSelectionMode,
    toggleSelection,
    clearSelection,
    getSelectedItems,
    selectedCount,
  } = useBatchSelection({ allItems: pipelineItems });

  // Keyboard navigation
  const {
    focusedStageIndex,
    focusedItemIndex,
    isNavigating,
    startNavigation,
    stopNavigation,
    getFocusedItemId,
  } = usePipelineKeyboard({
    stages: keyboardStages,
    itemsByStage,
    onReclassify: () => {
      // Not implementing reclassify for processes
    },
    onDelete: () => {
      const focusedId = getFocusedItemId();
      if (focusedId) {
        const [, id] = focusedId.split(":");
        if (id) {
          toggleSelection({ id, type: "process" }, false);
          setShowBulkDeleteDialog(true);
        }
      }
    },
  });

  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: ProcessPhase }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ phase: newPhase })
        .eq("id", processId);

      if (error) throw error;
      return { processId, newPhase };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      toast.success("Fase actualizada");

      // Check if we need to prompt for hearing date
      if (HEARING_PHASES.includes(data.newPhase)) {
        const process = processes?.find((p) => p.id === data.processId);
        if (process) {
          setHearingPrompt({
            open: true,
            processId: data.processId,
            filingId: process.linked_filing_id,
            radicado: process.radicado,
            targetPhase: data.newPhase,
          });
        }
      }
    },
    onError: () => {
      toast.error("Error al actualizar la fase");
    },
  });

  const toggleFlagMutation = useMutation({
    mutationFn: async ({ processId, isFlagged }: { processId: string; isFlagged: boolean }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ is_flagged: !isFlagged })
        .eq("id", processId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["process-pipeline"] });
      toast.success("Marcador actualizado");
    },
    onError: () => {
      toast.error("Error al actualizar marcador");
    },
  });

  const activeProcess = activeId
    ? processes?.find((p) => p.id === activeId)
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const processId = active.id as string;
    const newPhase = over.id as ProcessPhase;

    const process = processes?.find((p) => p.id === processId);
    if (!process) return;

    const currentPhase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
    if (currentPhase === newPhase) return;

    if (!PROCESS_PHASES_ORDER.includes(newPhase)) return;

    updatePhaseMutation.mutate({ processId, newPhase });
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleToggleFlag = (processId: string) => {
    const process = processes?.find((p) => p.id === processId);
    if (process) {
      toggleFlagMutation.mutate({ processId, isFlagged: !!process.is_flagged });
    }
  };

  const handleToggleSelect = (processId: string) => {
    toggleSelection({ id: processId, type: "process" }, false);
  };

  const handleBulkDeleteComplete = () => {
    clearSelection();
    setShowBulkDeleteDialog(false);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const allProcesses = processes || [];
  const rawFocusedId = getFocusedItemId();
  // getFocusedItemId returns "type:id", extract just the id
  const focusedItemId = rawFocusedId ? rawFocusedId.split(":")[1] : null;

  const processesByPhase: Record<ProcessPhase, MonitoredProcess[]> = {} as Record<ProcessPhase, MonitoredProcess[]>;
  PROCESS_PHASES_ORDER.forEach((phase) => {
    processesByPhase[phase] = [];
  });

  allProcesses.forEach((process) => {
    const phase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
    if (processesByPhase[phase]) {
      processesByPhase[phase].push(process);
    }
  });

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">Pipeline de Procesos</h3>
          <Badge variant="secondary">{allProcesses.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
          <Button
            variant={isNavigating ? "default" : "outline"}
            size="sm"
            onClick={() => (isNavigating ? stopNavigation() : startNavigation())}
            className="gap-1"
          >
            <Keyboard className="h-4 w-4" />
            {isNavigating ? "Salir" : "Teclado"}
          </Button>
          <Button
            variant={isSelectionMode ? "default" : "outline"}
            size="sm"
            onClick={() => (isSelectionMode ? clearSelection() : toggleSelection(pipelineItems[0], false))}
            className="gap-1"
            disabled={pipelineItems.length === 0}
          >
            <CheckSquare className="h-4 w-4" />
            {isSelectionMode ? `Selección (${selectedCount})` : "Seleccionar"}
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {isSelectionMode && selectedCount > 0 && (
        <ProcessBulkActionsBar
          selectedCount={selectedCount}
          onDelete={() => setShowBulkDeleteDialog(true)}
          onClear={clearSelection}
        />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-3 pb-4">
            {PROCESS_PHASES_ORDER.map((phase) => (
              <ProcessPipelineColumn
                key={phase}
                phase={phase}
                processes={processesByPhase[phase]}
                focusedItemId={focusedItemId}
                isSelectionMode={isSelectionMode}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onToggleFlag={handleToggleFlag}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeProcess ? (
            <ProcessPipelineCard process={activeProcess} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      {hearingPrompt && (
        <HearingPromptDialog
          open={hearingPrompt.open}
          onOpenChange={(open) => !open && setHearingPrompt(null)}
          processId={hearingPrompt.processId}
          filingId={hearingPrompt.filingId}
          radicado={hearingPrompt.radicado}
          targetPhase={hearingPrompt.targetPhase}
          onComplete={() => setHearingPrompt(null)}
        />
      )}

      {/* Bulk Delete Dialog */}
      <ProcessBulkDeleteDialog
        open={showBulkDeleteDialog}
        onOpenChange={setShowBulkDeleteDialog}
        selectedItems={getSelectedItems()}
        onComplete={handleBulkDeleteComplete}
      />
    </>
  );
}
