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
import { Building2, Keyboard, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { 
  GOV_PROCEDURE_STAGES,
  getStageOrderForWorkflow,
  type GovProcedureStage,
} from "@/lib/workflow-constants";
import { toast } from "sonner";
import { AdminPipelineColumn, AdminStageConfig } from "./AdminPipelineColumn";
import { AdminPipelineCard, AdminItem } from "./AdminPipelineCard";
import { BulkActionsBar } from "./BulkActionsBar";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";
import { useBatchSelection } from "@/hooks/use-batch-selection";

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

// Build admin stages configuration from GOV_PROCEDURE_STAGES
const ADMIN_STAGES: AdminStageConfig[] = getStageOrderForWorkflow("GOV_PROCEDURE").map((stageKey) => {
  const stageConfig = GOV_PROCEDURE_STAGES[stageKey as GovProcedureStage];
  return {
    id: `admin:${stageKey}`,
    label: stageConfig.label,
    shortLabel: stageConfig.label.length > 12 ? stageConfig.label.substring(0, 10) + "…" : stageConfig.label,
    color: STAGE_COLORS[stageKey] || "slate",
  };
});

interface RawWorkItem {
  id: string;
  radicado: string | null;
  stage: string;
  authority_name: string | null;
  authority_city: string | null;
  authority_department: string | null;
  authority_email: string | null;
  demandantes: string | null;
  demandados: string | null;
  title: string | null;
  notes: string | null;
  last_checked_at: string | null;
  updated_at: string;
  client_id: string | null;
  clients: { id: string; name: string } | null;
}

function rawToAdminItem(raw: RawWorkItem): AdminItem {
  return {
    id: raw.id,
    radicado: raw.radicado || raw.title || "Sin identificador",
    expedienteAdmin: null,
    autoridad: raw.authority_name,
    entidad: raw.authority_name,
    dependencia: null,
    tipoActuacion: null,
    correoAutoridad: raw.authority_email,
    department: raw.authority_department,
    municipality: raw.authority_city,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    clientId: raw.client_id,
    clientName: raw.clients?.name || null,
    adminPhase: raw.stage as GovProcedureStage | null,
    lastCheckedAt: raw.last_checked_at,
    notes: raw.notes,
  };
}

export function AdminPipeline() {
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<AdminItem | null>(null);
  const [deleteDialog, setDeleteDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch GOV_PROCEDURE work items from work_items table
  const { data: adminProcesses, isLoading } = useQuery({
    queryKey: ["gov-procedure-work-items"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("work_items")
        .select(`
          id, radicado, stage, authority_name, authority_city, authority_department,
          authority_email, demandantes, demandados, title, notes,
          last_checked_at, updated_at, client_id,
          clients:client_id(id, name)
        `)
        .eq("workflow_type", "GOV_PROCEDURE")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return (data as unknown as RawWorkItem[]).map(rawToAdminItem);
    },
  });

  // Mutation for updating work item stage
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ workItemId, newStage }: { workItemId: string; newStage: string }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ stage: newStage, updated_at: new Date().toISOString() })
        .eq("id", workItemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gov-procedure-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      toast.success("Etapa actualizada");
    },
    onError: () => toast.error("Error al actualizar etapa"),
  });

  // Bulk delete mutation using edge function
  const bulkDeleteMutation = useMutation({
    mutationFn: async (items: { id: string; type: string }[]) => {
      const ids = items.map(i => i.id);
      const { data, error } = await supabase.functions.invoke("delete-work-items", {
        body: { work_item_ids: ids, mode: "SOFT_DELETE" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["gov-procedure-work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items"] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      clearSelection();
      setDeleteDialog(false);
      toast.success(`${result?.deleted_count || 0} proceso${result?.deleted_count !== 1 ? "s" : ""} archivado${result?.deleted_count !== 1 ? "s" : ""}`);
    },
    onError: () => toast.error("Error al archivar elementos"),
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
        // Fallback to first stage if stage is unrecognized
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
    const targetStage = (over.id as string).replace("admin:", "");

    const item = allProcesses.find(i => i.id === itemId);
    if (!item) return;

    const currentPhase = item.adminPhase || "INICIO_APERTURA";
    if (currentPhase !== targetStage) {
      updatePhaseMutation.mutate({ workItemId: itemId, newStage: targetStage });
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
          <h2 className="text-lg font-semibold">Vía Gubernativa / Administrativos</h2>
          <Badge variant="secondary" className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 px-3 py-1">
            <Building2 className="h-3.5 w-3.5 mr-1.5" />
            {allProcesses.length} Procesos
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
        onBulkReclassify={() => toast.info("Usa arrastrar y soltar para cambiar etapa")}
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
    </>
  );
}
