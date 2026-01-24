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
import { Scale, CheckSquare, Plus, RefreshCw, Keyboard, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "@/contexts/OrganizationContext";
import {
  CPACA_PHASES,
  CPACA_PHASES_ORDER,
  type CpacaPhase,
  type MedioDeControl,
  type EstadoCaducidad,
} from "@/lib/cpaca-constants";
import { CpacaColumn, CpacaStageConfig } from "./CpacaColumn";
import { CpacaCard, CpacaItem } from "./CpacaCard";
import { NewCpacaDialog } from "./NewCpacaDialog";
import { CpacaBulkActionsBar } from "./CpacaBulkActionsBar";
import { CpacaBulkDeleteDialog } from "./CpacaBulkDeleteDialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Build stages configuration from constants
const CPACA_STAGES: CpacaStageConfig[] = CPACA_PHASES_ORDER.map((phase) => ({
  id: `cpaca:${phase}`,
  phase,
  ...CPACA_PHASES[phase],
}));

// Default phase for items without a valid phase
const DEFAULT_CPACA_PHASE: CpacaPhase = "PRECONTENCIOSO";

// Raw work_item structure from database
interface RawWorkItem {
  id: string;
  workflow_type: string;
  stage: string | null;
  radicado: string | null;
  title: string | null;
  authority_name: string | null;
  authority_city: string | null;
  demandantes: string | null;
  demandados: string | null;
  client_id: string | null;
  is_flagged: boolean | null;
  created_at: string;
  updated_at: string;
  clients: { id: string; name: string } | null;
}

function workItemToCpacaItem(raw: RawWorkItem): CpacaItem {
  // Map stage to CpacaPhase, with fallback to default
  let phase: CpacaPhase = DEFAULT_CPACA_PHASE;
  
  if (raw.stage && CPACA_PHASES_ORDER.includes(raw.stage as CpacaPhase)) {
    phase = raw.stage as CpacaPhase;
  }
  
  return {
    id: raw.id,
    type: "cpaca" as const,
    radicado: raw.radicado,
    titulo: raw.title,
    // Default medio de control since work_items may not have this
    medioDeControl: "OTRO" as MedioDeControl,
    medioDeControlCustom: null,
    phase,
    despachoNombre: raw.authority_name,
    despachoCiudad: raw.authority_city,
    demandantes: raw.demandantes,
    demandados: raw.demandados,
    clientId: raw.client_id,
    clientName: raw.clients?.name || null,
    estadoCaducidad: "NO_APLICA" as EstadoCaducidad,
    fechaVencimientoCaducidad: null,
    fechaVencimientoTraslado: null,
    fechaAudienciaInicial: null,
    createdAt: raw.created_at,
    isFlagged: raw.is_flagged ?? false,
  };
}

export function CpacaPipeline() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const [activeItem, setActiveItem] = useState<CpacaItem | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch CPACA work_items from canonical table
  // Note: RLS handles user scoping via owner_id, but we still need organizationId for cache key
  const { data: processes, isLoading, refetch, error } = useQuery({
    queryKey: ["cpaca-work-items", organizationId],
    queryFn: async (): Promise<CpacaItem[]> => {
      console.log("[CPACA Pipeline] Fetching CPACA work_items");

      // Break the type inference chain to avoid TS2589
      // RLS ensures we only get items where owner_id matches current user
      const baseQuery = supabase.from("work_items") as any;
      const result = await baseQuery
        .select("id, workflow_type, stage, radicado, title, authority_name, authority_city, demandantes, demandados, client_id, is_flagged, created_at, updated_at, clients(id, name)")
        .eq("workflow_type", "CPACA")
        .eq("status", "ACTIVE")
        .order("updated_at", { ascending: false });

      if (result.error) {
        console.error("[CPACA Pipeline] Query error:", result.error);
        throw result.error;
      }

      const data = result.data as RawWorkItem[];
      console.log("[CPACA Pipeline] Found items:", data?.length || 0);
      
      const items = data.map(workItemToCpacaItem);
      
      // Debug: log phase distribution
      const phaseDistribution: Record<string, number> = {};
      items.forEach(item => {
        phaseDistribution[item.phase] = (phaseDistribution[item.phase] || 0) + 1;
      });
      console.log("[CPACA Pipeline] Phase distribution:", phaseDistribution);
      
      return items;
    },
    enabled: true,
  });

  // Toggle flag mutation - update work_items
  const toggleFlagMutation = useMutation({
    mutationFn: async ({ id, isFlagged }: { id: string; isFlagged: boolean }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ is_flagged: !isFlagged })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items", organizationId] });
    },
  });

  // Update phase mutation - update work_items.stage
  const updatePhaseMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: CpacaPhase }) => {
      const { error } = await supabase
        .from("work_items")
        .update({ stage: newPhase, updated_at: new Date().toISOString() })
        .eq("id", processId);

      if (error) throw error;
      return { processId, newPhase };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
      queryClient.invalidateQueries({ queryKey: ["cpaca-work-items", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["work-items-list"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
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
        updatePhaseMutation.mutate({ processId: itemId, newPhase: targetPhase as CpacaPhase });
      }
    },
    [processes, updatePhaseMutation]
  );

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  // Group items by stage - ensure all items are included
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
        // Fallback to first stage (PRECONTENCIOSO) if phase not recognized
        console.warn(`[CPACA Pipeline] Unknown phase "${item.phase}" for item ${item.id}, using default`);
        result[CPACA_STAGES[0].id].push(item);
      }
    });

    // Sort flagged items to top
    Object.keys(result).forEach(key => {
      result[key].sort((a, b) => {
        if (a.isFlagged && !b.isFlagged) return -1;
        if (!a.isFlagged && b.isFlagged) return 1;
        return 0;
      });
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
      {/* Debug info (dev only) */}
      {process.env.NODE_ENV === "development" && (
        <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20">
          <AlertCircle className="h-4 w-4 text-blue-500" />
          <AlertDescription className="text-blue-700 dark:text-blue-300 text-sm">
            <strong>Debug:</strong> CPACA items found: {totalProcesses} | 
            workflow_type filter: CPACA | 
            org_id: {organizationId || "none"}
            {error && <span className="text-red-500"> | Error: {(error as Error).message}</span>}
          </AlertDescription>
        </Alert>
      )}

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

      {/* Empty state */}
      {totalProcesses === 0 && !isLoading && (
        <Alert className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No hay procesos CPACA en esta organización. Importa procesos desde ICARUS o crea uno nuevo.
          </AlertDescription>
        </Alert>
      )}

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
