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
import { FileText, Scale, Keyboard, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KANBAN_COLUMNS, PROCESS_PHASES_ORDER, PROCESS_PHASES, FILING_STATUSES } from "@/lib/constants";
import type { FilingStatus, ProcessPhase } from "@/lib/constants";
import { toast } from "sonner";
import { UnifiedPipelineColumn, StageConfig } from "./UnifiedPipelineColumn";
import { UnifiedPipelineCard, UnifiedItem } from "./UnifiedPipelineCard";
import { ClassificationDialog } from "./ClassificationDialog";
import { BulkActionsBar } from "./BulkActionsBar";
import { BulkDeleteDialog } from "./BulkDeleteDialog";
import { useUndoReclassification } from "@/hooks/use-undo-reclassification";
import { usePipelineKeyboard } from "@/hooks/use-pipeline-keyboard";
import { useBatchSelection } from "@/hooks/use-batch-selection";

// Build unified stages configuration
const FILING_STAGE_COLORS: Record<string, string> = {
  SENT_TO_REPARTO: "gray",
  ACTA_PENDING: "amber",
  ACTA_RECEIVED_PARSED: "sky",
  COURT_EMAIL_DRAFTED: "slate",
  RADICADO_PENDING: "zinc",
  RADICADO_CONFIRMED: "indigo",
  ICARUS_SYNC_PENDING: "violet",
  MONITORING_ACTIVE: "emerald",
};

const FILING_STAGES: StageConfig[] = KANBAN_COLUMNS.map((status) => ({
  id: `filing:${status}`,
  label: FILING_STATUSES[status].label,
  shortLabel: FILING_STATUSES[status].label.split(" ").slice(0, 2).join(" "),
  color: FILING_STAGE_COLORS[status] || "blue",
  type: "filing" as const,
}));

const PROCESS_STAGES: StageConfig[] = PROCESS_PHASES_ORDER.map((phase) => ({
  id: `process:${phase}`,
  label: PROCESS_PHASES[phase].label,
  shortLabel: PROCESS_PHASES[phase].shortLabel,
  color: PROCESS_PHASES[phase].color,
  type: "process" as const,
}));

const ALL_STAGES: StageConfig[] = [...FILING_STAGES, ...PROCESS_STAGES];

interface RawFiling {
  id: string;
  status: FilingStatus;
  filing_type: string;
  radicado: string | null;
  sla_acta_due_at: string | null;
  sla_court_reply_due_at: string | null;
  demandantes: string | null;
  demandados: string | null;
  court_name: string | null;
  has_auto_admisorio: boolean | null;
  linked_process_id: string | null;
  client_id: string | null;
  is_flagged: boolean | null;
  matter: { client_name: string; matter_name: string } | null;
  clients: { id: string; name: string } | null;
}

interface RawProcess {
  id: string;
  radicado: string;
  despacho_name: string | null;
  monitoring_enabled: boolean;
  last_checked_at: string | null;
  last_change_at: string | null;
  phase: ProcessPhase | null;
  demandantes: string | null;
  demandados: string | null;
  has_auto_admisorio: boolean | null;
  linked_filing_id: string | null;
  client_id: string | null;
  is_flagged: boolean | null;
  clients: { id: string; name: string } | null;
}

function filingToUnifiedItem(filing: RawFiling): UnifiedItem {
  return {
    id: filing.id,
    type: "filing",
    radicado: filing.radicado,
    clientId: filing.client_id,
    clientName: filing.clients?.name || filing.matter?.client_name || null,
    matterName: filing.matter?.matter_name,
    despachoName: filing.court_name,
    demandantes: filing.demandantes,
    demandados: filing.demandados,
    filingType: filing.filing_type,
    slaActaDueAt: filing.sla_acta_due_at,
    slaCourtReplyDueAt: filing.sla_court_reply_due_at,
    filingStatus: filing.status,
    linkedProcessId: filing.linked_process_id,
    hasAutoAdmisorio: filing.has_auto_admisorio ?? false,
    isFlagged: filing.is_flagged ?? false,
  };
}

function processToUnifiedItem(process: RawProcess): UnifiedItem {
  return {
    id: process.id,
    type: "process",
    radicado: process.radicado,
    clientId: process.client_id,
    clientName: process.clients?.name || null,
    despachoName: process.despacho_name,
    demandantes: process.demandantes,
    demandados: process.demandados,
    lastCheckedAt: process.last_checked_at,
    monitoringEnabled: process.monitoring_enabled,
    phase: process.phase,
    linkedFilingId: process.linked_filing_id,
    hasAutoAdmisorio: process.has_auto_admisorio ?? true,
    isFlagged: process.is_flagged ?? false,
  };
}

export function UnifiedPipeline() {
  const queryClient = useQueryClient();
  const { registerFilingToProcessUndo, registerProcessToFilingUndo } = useUndoReclassification();
  const [activeItem, setActiveItem] = useState<UnifiedItem | null>(null);
  const [classificationDialog, setClassificationDialog] = useState<{
    open: boolean;
    item: UnifiedItem | null;
    targetStage: StageConfig | null;
  }>({ open: false, item: null, targetStage: null });
  
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [createFilingOpen, setCreateFilingOpen] = useState(false);
  const [createProcessOpen, setCreateProcessOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Fetch filings
  const { data: filings, isLoading: filingsLoading } = useQuery({
    queryKey: ["unified-pipeline-filings"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("filings")
        .select(`
          id, status, filing_type, radicado, sla_acta_due_at, sla_court_reply_due_at,
          demandantes, demandados, court_name, has_auto_admisorio, linked_process_id, client_id, is_flagged,
          matter:matters(client_name, matter_name),
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .neq("status", "CLOSED")
        .neq("status", "DRAFTED");

      if (error) throw error;
      return (data as unknown as RawFiling[]).map(filingToUnifiedItem);
    },
  });

  // Fetch processes
  const { data: processes, isLoading: processesLoading } = useQuery({
    queryKey: ["unified-pipeline-processes"],
    queryFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      const { data, error } = await supabase
        .from("monitored_processes")
        .select(`
          id, radicado, despacho_name, monitoring_enabled, last_checked_at, last_change_at, phase,
          demandantes, demandados, has_auto_admisorio, linked_filing_id, client_id, is_flagged,
          clients(id, name)
        `)
        .eq("owner_id", user.user.id)
        .eq("monitoring_enabled", true);

      if (error) throw error;
      return (data as unknown as RawProcess[]).map(processToUnifiedItem);
    },
  });

  // Mutation for updating filing status
  const updateFilingMutation = useMutation({
    mutationFn: async ({ filingId, newStatus }: { filingId: string; newStatus: FilingStatus }) => {
      const { error } = await supabase
        .from("filings")
        .update({ status: newStatus })
        .eq("id", filingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      toast.success("Estado actualizado");
    },
    onError: () => toast.error("Error al actualizar estado"),
  });

  // Mutation for updating process phase
  const updateProcessMutation = useMutation({
    mutationFn: async ({ processId, newPhase }: { processId: string; newPhase: ProcessPhase }) => {
      const { error } = await supabase
        .from("monitored_processes")
        .update({ phase: newPhase })
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      toast.success("Fase actualizada");
    },
    onError: () => toast.error("Error al actualizar fase"),
  });

  // Mutation for converting filing to process
  const convertFilingToProcess = useMutation({
    mutationFn: async ({ filing, hasAutoAdmisorio }: { filing: UnifiedItem; hasAutoAdmisorio: boolean }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      // Store original state for undo
      const originalStatus = filing.filingStatus as FilingStatus;
      const originalHasAutoAdmisorio = filing.hasAutoAdmisorio;
      const originalLinkedProcessId = filing.linkedProcessId || null;
      let newProcessId: string | null = null;

      if (hasAutoAdmisorio) {
        // Create a linked process
        const { data: newProcess, error: processError } = await supabase
          .from("monitored_processes")
          .insert({
            owner_id: user.user.id,
            radicado: filing.radicado || `RAD-${Date.now()}`,
            despacho_name: filing.despachoName,
            demandantes: filing.demandantes,
            demandados: filing.demandados,
            monitoring_enabled: true,
            has_auto_admisorio: true,
            linked_filing_id: filing.id,
            phase: "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR" as ProcessPhase,
          })
          .select("id")
          .single();

        if (processError) throw processError;
        newProcessId = newProcess.id;

        // Update filing to link and mark as having auto admisorio
        const { error: filingError } = await supabase
          .from("filings")
          .update({
            has_auto_admisorio: true,
            linked_process_id: newProcess.id,
            status: "MONITORING_ACTIVE" as FilingStatus,
          })
          .eq("id", filing.id);

        if (filingError) throw filingError;
      } else {
        // Just mark as not having auto admisorio yet
        const { error } = await supabase
          .from("filings")
          .update({ has_auto_admisorio: false })
          .eq("id", filing.id);
        if (error) throw error;
      }

      return { filing, newProcessId, originalStatus, originalHasAutoAdmisorio, originalLinkedProcessId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      
      // Register undo
      registerFilingToProcessUndo(
        data.filing.id,
        data.newProcessId,
        data.originalStatus,
        data.originalHasAutoAdmisorio,
        data.originalLinkedProcessId,
        data.filing.radicado
      );
    },
    onError: () => toast.error("Error al clasificar"),
  });

  // Mutation for converting process to filing
  const convertProcessToFiling = useMutation({
    mutationFn: async ({ process, hasAutoAdmisorio, targetStatus }: { process: UnifiedItem; hasAutoAdmisorio: boolean; targetStatus?: FilingStatus }) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No user");

      // Store original state for undo
      const originalPhase = process.phase as ProcessPhase | null;
      const originalHasAutoAdmisorio = process.hasAutoAdmisorio;
      const originalLinkedFilingId = process.linkedFilingId || null;
      const originalMonitoringEnabled = process.monitoringEnabled ?? true;
      let newFilingId: string | null = null;

      if (!hasAutoAdmisorio) {
        // Create a linked filing
        // First need to get or create a matter
        const { data: existingMatters } = await supabase
          .from("matters")
          .select("id")
          .eq("owner_id", user.user.id)
          .limit(1);

        let matterId = existingMatters?.[0]?.id;

        if (!matterId) {
          const { data: newMatter, error: matterError } = await supabase
            .from("matters")
            .insert({
              owner_id: user.user.id,
              client_name: process.clientName || "Cliente sin nombre",
              matter_name: `Asunto ${process.radicado || "nuevo"}`,
            })
            .select("id")
            .single();
          
          if (matterError) throw matterError;
          matterId = newMatter.id;
        }

        // Use target status from drag or fallback
        const filingStatus = targetStatus || ("SENT_TO_REPARTO" as FilingStatus);

        const { data: newFiling, error: filingError } = await supabase
          .from("filings")
          .insert({
            owner_id: user.user.id,
            matter_id: matterId,
            radicado: process.radicado,
            court_name: process.despachoName,
            demandantes: process.demandantes,
            demandados: process.demandados,
            filing_type: "Demanda",
            has_auto_admisorio: false,
            linked_process_id: process.id,
            status: filingStatus,
          })
          .select("id")
          .single();

        if (filingError) throw filingError;
        newFilingId = newFiling.id;

        // Update process to link and disable monitoring (no longer shown in pipeline)
        const { error: processError } = await supabase
          .from("monitored_processes")
          .update({
            has_auto_admisorio: false,
            linked_filing_id: newFiling.id,
            monitoring_enabled: false,
          })
          .eq("id", process.id);

        if (processError) throw processError;
      } else {
        // Just mark as having auto admisorio
        const { error } = await supabase
          .from("monitored_processes")
          .update({ has_auto_admisorio: true })
          .eq("id", process.id);
        if (error) throw error;
      }

      return { process, newFilingId, originalPhase, originalHasAutoAdmisorio, originalLinkedFilingId, originalMonitoringEnabled };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      
      // Register undo
      registerProcessToFilingUndo(
        data.process.id,
        data.newFilingId,
        data.originalPhase,
        data.originalHasAutoAdmisorio,
        data.originalLinkedFilingId,
        data.originalMonitoringEnabled,
        data.process.radicado
      );
    },
    onError: () => toast.error("Error al clasificar"),
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (items: { id: string; type: "filing" | "process" }[]) => {
      const filingIds = items.filter(i => i.type === "filing").map(i => i.id);
      const processIds = items.filter(i => i.type === "process").map(i => i.id);

      // Delete filings and their related data
      if (filingIds.length > 0) {
        // Delete related documents
        await supabase.from("documents").delete().in("filing_id", filingIds);
        // Delete related hearings
        await supabase.from("hearings").delete().in("filing_id", filingIds);
        // Delete related process_events
        await supabase.from("process_events").delete().in("filing_id", filingIds);
        // Delete related emails
        await supabase.from("emails").delete().in("filing_id", filingIds);
        // Delete related email_threads
        await supabase.from("email_threads").delete().in("filing_id", filingIds);
        // Delete related tasks
        await supabase.from("tasks").delete().in("filing_id", filingIds);
        // Delete related alerts
        await supabase.from("alerts").delete().in("filing_id", filingIds);
        // Finally delete the filings
        const { error } = await supabase.from("filings").delete().in("id", filingIds);
        if (error) throw error;
      }

      // Delete processes and their related data
      if (processIds.length > 0) {
        // Delete related process_events
        await supabase.from("process_events").delete().in("monitored_process_id", processIds);
        // Delete related evidence_snapshots
        await supabase.from("evidence_snapshots").delete().in("monitored_process_id", processIds);
        // Delete related process_estados
        await supabase.from("process_estados").delete().in("monitored_process_id", processIds);
        // Finally delete the processes
        const { error } = await supabase.from("monitored_processes").delete().in("id", processIds);
        if (error) throw error;
      }

      return { filingIds, processIds };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      queryClient.invalidateQueries({ queryKey: ["filings"] });
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      queryClient.invalidateQueries({ queryKey: ["monitored-processes"] });
      clearSelection();
      setDeleteDialog(false);
      
      const total = data.filingIds.length + data.processIds.length;
      toast.success(`${total} elemento${total !== 1 ? "s" : ""} eliminado${total !== 1 ? "s" : ""}`);
    },
    onError: () => {
      toast.error("Error al eliminar elementos");
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    const itemId = event.active.id as string;
    const [type, id] = itemId.split(":");
    
    const allItems = [...(filings || []), ...(processes || [])];
    const item = allItems.find(i => i.type === type && i.id === id);
    setActiveItem(item || null);
  };

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveItem(null);

    if (!over) return;

    const activeId = active.id as string;
    const [itemType, itemId] = activeId.split(":");
    const [targetType, targetStatus] = (over.id as string).split(":");

    const allItems = [...(filings || []), ...(processes || [])];
    const item = allItems.find(i => i.type === itemType && i.id === itemId);
    if (!item) return;

    const targetStage = ALL_STAGES.find(s => s.id === over.id);
    if (!targetStage) return;

    // Check if moving between types (filing <-> process)
    if (itemType !== targetType) {
      // Show classification dialog
      setClassificationDialog({
        open: true,
        item,
        targetStage,
      });
      return;
    }

    // Same type movement
    if (itemType === "filing") {
      const currentStatus = item.filingStatus as FilingStatus;
      if (currentStatus !== targetStatus) {
        updateFilingMutation.mutate({ filingId: itemId, newStatus: targetStatus as FilingStatus });
      }
    } else {
      const currentPhase = item.phase as ProcessPhase;
      if (currentPhase !== targetStatus) {
        updateProcessMutation.mutate({ processId: itemId, newPhase: targetStatus as ProcessPhase });
      }
    }
  }, [filings, processes, updateFilingMutation, updateProcessMutation]);

  const handleDragCancel = () => {
    setActiveItem(null);
  };

  const handleReclassify = (item: UnifiedItem) => {
    setClassificationDialog({
      open: true,
      item,
      targetStage: null,
    });
  };

  const handleClassify = (hasAutoAdmisorio: boolean) => {
    const { item, targetStage } = classificationDialog;
    if (!item) return;

    if (item.type === "filing") {
      convertFilingToProcess.mutate({ filing: item, hasAutoAdmisorio });
    } else {
      // Extract target status from stage id if converting process to filing
      const targetStatus = targetStage?.type === "filing" 
        ? (targetStage.id.replace("filing:", "") as FilingStatus)
        : undefined;
      convertProcessToFiling.mutate({ process: item, hasAutoAdmisorio, targetStatus });
    }

    setClassificationDialog({ open: false, item: null, targetStage: null });
  };

  const isLoading = filingsLoading || processesLoading;

  const allFilings = filings || [];
  const allProcesses = processes || [];

  // Memoize itemsByStage to ensure stable reference for hooks
  const itemsByStage = useMemo(() => {
    const result: Record<string, UnifiedItem[]> = {};
    ALL_STAGES.forEach((stage) => {
      result[stage.id] = [];
    });

    const placedItemIds = new Set<string>();

    // Place filings - only in filing stages
    allFilings.forEach((filing) => {
      const uniqueKey = `filing:${filing.id}`;
      if (placedItemIds.has(uniqueKey)) return;
      
      const stageId = `filing:${filing.filingStatus}`;
      if (result[stageId]) {
        result[stageId].push(filing);
        placedItemIds.add(uniqueKey);
      } else {
        const firstFilingStage = FILING_STAGES[0];
        if (firstFilingStage && result[firstFilingStage.id]) {
          result[firstFilingStage.id].push(filing);
          placedItemIds.add(uniqueKey);
        }
      }
    });

    // Place processes - only in process stages
    allProcesses.forEach((process) => {
      const uniqueKey = `process:${process.id}`;
      if (placedItemIds.has(uniqueKey)) return;
      
      if (process.linkedFilingId) {
        const linkedFilingShown = allFilings.some(f => f.id === process.linkedFilingId);
        if (linkedFilingShown) return;
      }
      
      const hasLinkedFiling = allFilings.some(f => f.linkedProcessId === process.id);
      if (hasLinkedFiling) return;
      
      const phase = process.phase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR";
      const stageId = `process:${phase}`;
      if (result[stageId]) {
        result[stageId].push(process);
        placedItemIds.add(uniqueKey);
      } else {
        const firstProcessStage = PROCESS_STAGES[0];
        if (firstProcessStage && result[firstProcessStage.id]) {
          result[firstProcessStage.id].push(process);
          placedItemIds.add(uniqueKey);
        }
      }
    });

    return result;
  }, [allFilings, allProcesses]);

  // Calculate counts
  const totalFilings = allFilings.length;
  const totalProcesses = allProcesses.filter(p => !p.linkedFilingId || !allFilings.some(f => f.id === p.linkedFilingId)).length;

  // Flatten all items for batch selection
  const allItemsFlat = useMemo(() => {
    const items: UnifiedItem[] = [];
    ALL_STAGES.forEach(stage => {
      items.push(...(itemsByStage[stage.id] || []));
    });
    return items;
  }, [itemsByStage]);

  // Batch selection - MUST be called before any early returns
  const {
    isSelectionMode,
    toggleSelection,
    isSelected,
    selectAllOfType,
    clearSelection,
    getSelectionCounts,
    getSelectedItems,
    selectedCount,
  } = useBatchSelection({ allItems: allItemsFlat });

  const selectionCounts = getSelectionCounts();

  // Handle bulk reclassify - show dialog for first selected item
  const handleBulkReclassify = useCallback(() => {
    if (selectedCount === 0) return;
    toast.info("Selecciona un item individual para reclasificar", {
      description: "La reclasificación en lote no está disponible aún",
    });
  }, [selectedCount]);

  // Keyboard navigation - memoize stages for hook
  const stagesForKeyboard = useMemo(() => 
    ALL_STAGES.map(s => ({ id: s.id, type: s.type })), 
    []
  );
  
  const { 
    isNavigating, 
    startNavigation, 
    getFocusedItemId 
  } = usePipelineKeyboard({
    stages: stagesForKeyboard,
    itemsByStage,
    onReclassify: handleReclassify,
    enabled: !isSelectionMode,
  });

  const focusedItemId = getFocusedItemId();

  // Toggle selection mode
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

  // Loading state - AFTER all hooks
  if (isLoading) {
    return (
      <div className="flex gap-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-[400px] w-64 flex-shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Pipeline Header with Counts */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Pipeline Unificado</h2>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 px-3 py-1">
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              {totalFilings} Radicaciones
            </Badge>
            <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300 px-3 py-1">
              <Scale className="h-3.5 w-3.5 mr-1.5" />
              {totalProcesses} Procesos
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectionMode}
            className={isSelectionMode ? "ring-2 ring-primary bg-primary/10" : ""}
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            {isSelectionMode ? "Cancelar selección" : "Seleccionar"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={startNavigation}
            className={isNavigating ? "ring-2 ring-primary" : ""}
            disabled={isSelectionMode}
          >
            <Keyboard className="h-4 w-4 mr-2" />
            {isNavigating ? "Navegando" : "Tab para navegar"}
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
            {ALL_STAGES.map((stage) => (
              <UnifiedPipelineColumn
                key={stage.id}
                stage={stage}
                items={itemsByStage[stage.id]}
                focusedItemId={focusedItemId}
                isSelectionMode={isSelectionMode}
                isItemSelected={isSelected}
                onReclassify={handleReclassify}
                onToggleSelection={toggleSelection}
              />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        <DragOverlay>
          {activeItem ? (
            <UnifiedPipelineCard item={activeItem} isDragging />
          ) : null}
        </DragOverlay>
      </DndContext>

      <ClassificationDialog
        open={classificationDialog.open}
        onOpenChange={(open) => setClassificationDialog(prev => ({ ...prev, open }))}
        radicado={classificationDialog.item?.radicado || null}
        currentType={classificationDialog.item?.type || "filing"}
        onClassify={handleClassify}
      />

      <BulkActionsBar
        selectedCount={selectedCount}
        filingsCount={selectionCounts.filings}
        processesCount={selectionCounts.processes}
        onSelectAllFilings={() => selectAllOfType("filing")}
        onSelectAllProcesses={() => selectAllOfType("process")}
        onClearSelection={clearSelection}
        onBulkReclassify={handleBulkReclassify}
        onBulkDelete={() => setDeleteDialog(true)}
        isDeleting={bulkDeleteMutation.isPending}
      />

      <BulkDeleteDialog
        open={deleteDialog}
        onOpenChange={setDeleteDialog}
        filingsCount={selectionCounts.filings}
        processesCount={selectionCounts.processes}
        onConfirm={() => {
          const selected = getSelectedItems() as { id: string; type: "filing" | "process" }[];
          bulkDeleteMutation.mutate(selected);
        }}
        isDeleting={bulkDeleteMutation.isPending}
      />
    </>
  );
}
