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
import { Scale, CheckSquare, Plus, RefreshCw, Keyboard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CPACA_PHASES,
  CPACA_PHASES_ORDER,
  ESTADOS_CONCILIACION,
  PHASES_REQUIRING_CONCILIACION,
  type CpacaPhase,
  type MedioDeControl,
  type EstadoCaducidad,
  type EstadoConciliacion,
} from "@/lib/cpaca-constants";
import { CpacaColumn, CpacaStageConfig } from "./CpacaColumn";
import { CpacaCard, CpacaItem } from "./CpacaCard";
import { NewCpacaDialog } from "./NewCpacaDialog";
import { CpacaBulkActionsBar } from "./CpacaBulkActionsBar";
import { CpacaBulkDeleteDialog } from "./CpacaBulkDeleteDialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";

// Build stages configuration from constants
const CPACA_STAGES: CpacaStageConfig[] = CPACA_PHASES_ORDER.map((phase) => ({
  id: `cpaca:${phase}`,
  phase,
  ...CPACA_PHASES[phase],
}));

interface RawCpacaProcess {
  id: string;
  radicado: string | null;
  titulo: string | null;
  medio_de_control: string;
  medio_de_control_custom: string | null;
  phase: string;
  despacho_nombre: string | null;
  despacho_ciudad: string | null;
  demandantes: string | null;
  demandados: string | null;
  client_id: string | null;
  estado_caducidad: string | null;
  estado_conciliacion: string | null;
  conciliacion_requisito: boolean;
  fecha_vencimiento_caducidad: string | null;
  fecha_vencimiento_traslado_demanda: string | null;
  fecha_audiencia_inicial: string | null;
  created_at: string;
  is_flagged: boolean | null;
  clients: { id: string; name: string } | null;
}

function rawToCpacaItem(raw: RawCpacaProcess): CpacaItem {
  return {
    id: raw.id,
    type: "cpaca" as const,
    radicado: raw.radicado,
    titulo: raw.titulo,
    medioDeControl: raw.medio_de_control as MedioDeControl,
    medioDeControlCustom: raw.medio_de_control_custom,
    phase: raw.phase as CpacaPhase,
    despachoNombre: raw.despacho_nombre,
    despachoCiudad: raw.despacho_ciudad,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    clientId: raw.client_id,
    clientName: raw.clients?.name || null,
    estadoCaducidad: (raw.estado_caducidad || "NO_APLICA") as EstadoCaducidad,
    fechaVencimientoCaducidad: raw.fecha_vencimiento_caducidad,
    fechaVencimientoTraslado: raw.fecha_vencimiento_traslado_demanda,
    fechaAudienciaInicial: raw.fecha_audiencia_inicial,
    createdAt: raw.created_at,
    isFlagged: raw.is_flagged ?? false,
  };
}

export function CpacaPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<CpacaItem | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch CPACA processes
  const { data: processes, isLoading, refetch } = useQuery({
    queryKey: ["cpaca-processes"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("cpaca_processes")
        .select(`
          id, radicado, titulo, medio_de_control, medio_de_control_custom,
          phase, despacho_nombre, despacho_ciudad, demandantes, demandados,
          client_id, estado_caducidad, estado_conciliacion, conciliacion_requisito,
          fecha_vencimiento_caducidad, fecha_vencimiento_traslado_demanda,
          fecha_audiencia_inicial, created_at, is_flagged,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawCpacaProcess[]).map(rawToCpacaItem);
    },
  });

  // Toggle flag mutation
  const toggleFlagMutation = useMutation({
    mutationFn: async ({ id, isFlagged }: { id: string; isFlagged: boolean }) => {
      const { error } = await supabase
        .from("cpaca_processes")
        .update({ is_flagged: !isFlagged })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpaca-processes"] });
    },
  });

  // Update phase mutation
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: CpacaPhase }) => {
      const { error } = await supabase
        .from("cpaca_processes")
        .update({ phase: newPhase })
        .eq("id", processId);

      if (error) throw error;
      return { processId, newPhase };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpaca-processes"] });
      toast.success("Estado actualizado");
    },
    onError: () => toast.error("Error al actualizar estado"),
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
      queryClient.invalidateQueries({ queryKey: ["cpaca-processes"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${result?.deleted_count || 0} proceso${result?.deleted_count !== 1 ? "s" : ""} eliminado${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => {
      toast.error("Error al eliminar procesos");
    },
  });

  // Drag handlers
  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const [, id] = itemId.split(":");
    const item = processes?.find((p) => p.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveItem(null);

      if (!over) return;

      const activeId = active.id as string;
      const [, itemId] = activeId.split(":");
      const [, targetPhase] = (over.id as string).split(":");

      const item = processes?.find((p) => p.id === itemId);
      if (!item) return;

      if (item.phase !== targetPhase) {
        // Validate conciliación requirement for certain phases
        // (In a full implementation, we'd fetch the full process data and check estado_conciliacion)
        updatePhaseMutation.mutate({ processId: itemId, newPhase: targetPhase as CpacaPhase });
      }
    },
    [processes, updatePhaseMutation]
  );

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Group items by stage
  const itemsByStage = useMemo(() => {
    const result: Record<string, CpacaItem[]> = {};
    CPACA_STAGES.forEach((stage) => {
      result[stage.id] = [];
    });

    processes?.forEach((item) => {
      const stageId = `cpaca:${item.phase}`;
      if (result[stageId]) {
        result[stageId].push(item);
      } else {
        // Fallback to first stage
        result[CPACA_STAGES[0].id].push(item);
      }
    });

    return result;
  }, [processes]);

  // Flatten items for batch selection
  const allItemsFlat = useMemo(() => {
    const items: { id: string; type: "cpaca" }[] = [];
    CPACA_STAGES.forEach((stage) => {
      itemsByStage[stage.id]?.forEach((item) => {
        items.push({ id: item.id, type: "cpaca" as const });
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

  // Wrapper for selection
  const isItemSelected = useCallback(
    (item: { id: string; type: "cpaca" }) => isSelected(item),
    [isSelected]
  );

  const toggleItemSelection = useCallback(
    (item: { id: string; type: "cpaca" }, shiftKey: boolean) => toggleSelection(item, shiftKey),
    [toggleSelection]
  );

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

  // Handle toggle flag
  const handleToggleFlag = useCallback((item: CpacaItem) => {
    toggleFlagMutation.mutate({ id: item.id, isFlagged: item.isFlagged });
  }, [toggleFlagMutation]);

  // Keyboard navigation - memoize stages for hook
  const stagesForKeyboard = useMemo(() => 
    CPACA_STAGES.map(s => ({ id: s.id, type: "cpaca" as const })), 
    []
  );
  
  const { 
    isNavigating, 
    startNavigation, 
    getFocusedItemId 
  } = usePipelineKeyboard({
    stages: stagesForKeyboard,
    itemsByStage,
    onReclassify: () => {},
    enabled: !isSelectionMode,
  });

  const focusedItemId = getFocusedItemId();

  if (isLoading) {
    return (
      <div className="flex gap-4">
        {CPACA_STAGES.slice(0, 6).map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  const totalProcesses = processes?.length || 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Pipeline CPACA</h2>
          <Badge
            variant="secondary"
            className="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 px-3 py-1"
          >
            <Scale className="h-3.5 w-3.5 mr-1.5" />
            {totalProcesses} Proceso{totalProcesses !== 1 ? "s" : ""}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectionMode}
            className={isSelectionMode ? "ring-2 ring-primary bg-primary/10" : ""}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            {isSelectionMode ? "Cancelar" : "Seleccionar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startNavigation}
            className={isNavigating ? "ring-2 ring-primary" : ""}
            disabled={isSelectionMode}
          >
            <Keyboard className="h-4 w-4 mr-2" />
            {isNavigating ? "Navegando" : "Tab"}
          </Button>
          <Button onClick={() => setNewDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nuevo CPACA
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
            {CPACA_STAGES.map((stage) => (
              <CpacaColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                focusedItemId={focusedItemId}
                isSelectionMode={isSelectionMode}
                isItemSelected={isItemSelected}
                onToggleSelection={toggleItemSelection}
                onToggleFlag={handleToggleFlag}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? <CpacaCard item={activeItem} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Dialogs */}
      <NewCpacaDialog open={newDialogOpen} onOpenChange={setNewDialogOpen} />

      <CpacaBulkActionsBar
        selectedCount={selectedCount}
        onSelectAll={selectAll}
        onClearSelection={clearSelection}
        onBulkDelete={() => setDeleteDialog(true)}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <CpacaBulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        count={selectedCount}
        onConfirm={() => {
          const ids = getSelectedItems().map((i) => i.id);
          bulkDeleteMutation.mutate(ids);
        }}
        isDeleting={bulkDeleteMutation.isPending}
      />
    </>
  );
}
