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
import { Building2, Keyboard, CheckSquare, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { 
  ADMIN_PROCESS_PHASES, 
  ADMIN_PROCESS_PHASES_ORDER,
  type AdminProcessPhase 
} from "@/lib/admin-constants";
import { toast } from "sonner";
import { AdminPipelineColumn, AdminStageConfig } from "./AdminPipelineColumn";
import { AdminPipelineCard, AdminItem } from "./AdminPipelineCard";
import { BulkActionsBar } from "./BulkActionsBar";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { NewAdminProcessDialog } from "./NewAdminProcessDialog";

// Build admin stages configuration
const ADMIN_STAGES: AdminStageConfig[] = ADMIN_PROCESS_PHASES_ORDER.map((phase) => ({
  id: `admin:${phase}`,
  label: ADMIN_PROCESS_PHASES[phase].label,
  shortLabel: ADMIN_PROCESS_PHASES[phase].shortLabel,
  color: ADMIN_PROCESS_PHASES[phase].color,
}));

interface RawAdminProcess {
  id: string;
  radicado: string;
  admin_phase: string | null;
  autoridad: string | null;
  entidad: string | null;
  dependencia: string | null;
  expediente_administrativo: string | null;
  tipo_actuacion: string | null;
  correo_autoridad: string | null;
  department: string | null;
  municipality: string | null;
  demandantes: string | null;
  demandados: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  notes: string | null;
  client_id: string | null;
  clients: { id: string; name: string } | null;
}

function rawToAdminItem(raw: RawAdminProcess): AdminItem {
  return {
    id: raw.id,
    radicado: raw.radicado,
    expedienteAdmin: raw.expediente_administrativo,
    autoridad: raw.autoridad,
    entidad: raw.entidad,
    dependencia: raw.dependencia,
    tipoActuacion: raw.tipo_actuacion,
    correoAutoridad: raw.correo_autoridad,
    department: raw.department,
    municipality: raw.municipality,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    clientName: raw.clients?.name || null,
    adminPhase: raw.admin_phase as AdminProcessPhase | null,
    lastCheckedAt: raw.last_checked_at,
    notes: raw.notes,
  };
}

export function AdminPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<AdminItem | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [newProcessDialog, setNewProcessDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch administrative processes
  const { data: adminProcesses, isLoading } = useQuery({
    queryKey: ["admin-pipeline-processes"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(`
          id, radicado, admin_phase, autoridad, entidad, dependencia,
          expediente_administrativo, tipo_actuacion, correo_autoridad,
          department, municipality, demandantes, demandados,
          monitoring_enabled, last_checked_at, last_change_at, notes, client_id,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("process_type", "ADMINISTRATIVE");

      if (error) throw error;
      return (data as unknown as RawAdminProcess[]).map(rawToAdminItem);
    },
  });

  // Mutation for updating admin process phase
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: AdminProcessPhase }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ admin_phase: newPhase })
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-pipeline-processes"] });
      toast.success("Fase actualizada");
    },
    onError: () => toast.error("Error al actualizar fase"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (items: { id: string; type: string }[]) => {
      const processIds = items.map(i => i.id);

      if (processIds.length > 0) {
        await supabase.from("process_events").delete().in("monitored_process_id", processIds);
        await supabase.from("evidence_snapshots").delete().in("monitored_process_id", processIds);
        await supabase.from("process_estados").delete().in("monitored_process_id", processIds);
        const { error } = await supabase.from("monitored_processes").delete().in("id", processIds);
        if (error) throw error;
      }

      return { processIds };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-pipeline-processes"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${data.processIds.length} proceso${data.processIds.length !== 1 ? "s" : ""} eliminado${data.processIds.length !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al eliminar elementos"),
  });

  const allProcesses = adminProcesses || [];

  // Memoize itemsByStage
  const itemsByStage = useMemo(() => {
    const result: Record<string, AdminItem[]> = {};
    ADMIN_STAGES.forEach((stage) => {
      result[stage.id] = [];
    });

    allProcesses.forEach((process) => {
      const phase = process.adminPhase || "INICIO_APERTURA";
      const stageId = `admin:${phase}`;
      if (result[stageId]) {
        result[stageId].push(process);
      } else {
        const firstStage = ADMIN_STAGES[0];
        if (firstStage && result[firstStage.id]) {
          result[firstStage.id].push(process);
        }
      }
    });

    return result;
  }, [allProcesses]);

  // Flatten for batch selection
  const allItemsFlat = useMemo(() => {
    const items: AdminItem[] = [];
    ADMIN_STAGES.forEach(stage => {
      items.push(...(itemsByStage[stage.id] || []));
    });
    return items.map(item => ({ id: item.id, type: "process" as const }));
  }, [itemsByStage]);

  // Batch selection
  const {
    isSelectionMode,
    toggleSelection,
    isSelected,
    clearSelection,
    getSelectionCounts,
    getSelectedItems,
    selectedCount,
  } = useBatchSelection({ allItems: allItemsFlat });

  const selectionCounts = getSelectionCounts();

  // Keyboard navigation
  const stagesForKeyboard = useMemo(() => 
    ADMIN_STAGES.map(s => ({ id: s.id, type: "process" as const })), 
    []
  );
  
  const itemsByStageForKeyboard = useMemo(() => {
    const result: Record<string, { id: string; type: "process"; radicado?: string }[]> = {};
    ADMIN_STAGES.forEach(stage => {
      result[stage.id] = (itemsByStage[stage.id] || []).map(item => ({
        id: item.id,
        type: "process" as const,
        radicado: item.radicado,
      }));
    });
    return result;
  }, [itemsByStage]);
  
  const { 
    isNavigating, 
    startNavigation, 
    getFocusedItemId 
  } = usePipelineKeyboard({
    stages: stagesForKeyboard,
    itemsByStage: itemsByStageForKeyboard,
    onReclassify: () => {},
    enabled: !isSelectionMode,
  });

  const focusedItemId = getFocusedItemId();

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

  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const id = itemId.replace("admin:", "");
    const item = allProcesses.find(i => i.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const activeId = active.id as string;
    const itemId = activeId.replace("admin:", "");
    const targetPhase = (over.id as string).replace("admin:", "") as AdminProcessPhase;

    const item = allProcesses.find(i => i.id === itemId);
    if (!item) return;

    const currentPhase = item.adminPhase || "INICIO_APERTURA";
    if (currentPhase !== targetPhase) {
      updatePhaseMutation.mutate({ processId: itemId, newPhase: targetPhase });
    }
  }, [allProcesses, updatePhaseMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  const handleToggleSelection = useCallback((item: AdminItem, shiftKey: boolean) => {
    toggleSelection({ id: item.id, type: "process" }, shiftKey);
  }, [toggleSelection]);

  const isItemSelected = useCallback((item: AdminItem) => {
    return isSelected({ id: item.id, type: "process" });
  }, [isSelected]);

  // Loading state - AFTER all hooks
  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[...Array(9)].map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Pipeline Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Procesos Administrativos</h2>
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 px-3 py-1">
            <Building2 className="h-3.5 w-3.5 mr-1.5" />
            {allProcesses.length} Procesos
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewProcessDialog(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuevo
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
            {isNavigating ? "Navegando" : "Teclado"}
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex gap-3 pb-4">
            {ADMIN_STAGES.map((stage) => (
              <AdminPipelineColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id] || []}
                focusedItemId={focusedItemId}
                isSelectionMode={isSelectionMode}
                isItemSelected={isItemSelected}
                onToggleSelection={handleToggleSelection}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? (
            <AdminPipelineCard item={activeItem} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <BulkActionsBar
        selectedCount={selectedCount}
        filingsCount={0}
        processesCount={selectionCounts.processes}
        onSelectAllFilings={() => {}}
        onSelectAllProcesses={() => {}}
        onClearSelection={clearSelection}
        onBulkReclassify={() => toast.info("Usa arrastrar y soltar para cambiar fase")}
        onBulkDelete={() => setDeleteDialog(true)}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <BulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        filingsCount={0}
        processesCount={selectedCount}
        onConfirm={() => {
          const selected = getSelectedItems();
          bulkDeleteMutation.mutate(selected);
        }}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <NewAdminProcessDialog
        open={newProcessDialog}
        onOpenChange={setNewProcessDialog}
      />
    </>
  );
}
