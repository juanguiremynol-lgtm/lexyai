import { useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { FilingStatus, ProcessPhase } from "@/lib/constants";

interface UndoState {
  type: "filing-to-process" | "process-to-filing";
  filingId?: string;
  processId?: string;
  newProcessId?: string;
  newFilingId?: string;
  originalFilingStatus?: FilingStatus;
  originalFilingHasAutoAdmisorio?: boolean;
  originalFilingLinkedProcessId?: string | null;
  originalProcessPhase?: ProcessPhase;
  originalProcessHasAutoAdmisorio?: boolean;
  originalProcessLinkedFilingId?: string | null;
  originalProcessMonitoringEnabled?: boolean;
}

const UNDO_TIMEOUT_MS = 10000;

export function useUndoReclassification() {
  const queryClient = useQueryClient();
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUndoRef = useRef<UndoState | null>(null);

  const clearPendingUndo = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    pendingUndoRef.current = null;
  }, []);

  const performUndo = useCallback(async () => {
    const undoState = pendingUndoRef.current;
    if (!undoState) return;

    clearPendingUndo();

    try {
      if (undoState.type === "filing-to-process") {
        // Undo: filing was converted to process
        // 1. Delete the new process if it was created
        if (undoState.newProcessId) {
          await supabase
            .from("monitored_processes")
            .delete()
            .eq("id", undoState.newProcessId);
        }

        // 2. Restore the filing to its original state
        if (undoState.filingId) {
          await supabase
            .from("filings")
            .update({
              status: undoState.originalFilingStatus,
              has_auto_admisorio: undoState.originalFilingHasAutoAdmisorio,
              linked_process_id: undoState.originalFilingLinkedProcessId,
            })
            .eq("id", undoState.filingId);
        }
      } else if (undoState.type === "process-to-filing") {
        // Undo: process was converted to filing
        // 1. Delete the new filing if it was created
        if (undoState.newFilingId) {
          await supabase
            .from("filings")
            .delete()
            .eq("id", undoState.newFilingId);
        }

        // 2. Restore the process to its original state
        if (undoState.processId) {
          await supabase
            .from("monitored_processes")
            .update({
              phase: undoState.originalProcessPhase,
              has_auto_admisorio: undoState.originalProcessHasAutoAdmisorio,
              linked_filing_id: undoState.originalProcessLinkedFilingId,
              monitoring_enabled: undoState.originalProcessMonitoringEnabled,
            })
            .eq("id", undoState.processId);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-filings"] });
      queryClient.invalidateQueries({ queryKey: ["unified-pipeline-processes"] });
      toast.success("Reclasificación deshecha");
    } catch (error) {
      console.error("Error undoing reclassification:", error);
      toast.error("Error al deshacer la reclasificación");
    }
  }, [queryClient, clearPendingUndo]);

  const showUndoToast = useCallback((radicado: string | null) => {
    // Clear any existing timeout
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
    }

    // Set up auto-clear after timeout
    undoTimeoutRef.current = setTimeout(() => {
      pendingUndoRef.current = null;
    }, UNDO_TIMEOUT_MS);

    // Show toast with undo action
    toast.success("Clasificación actualizada", {
      description: radicado ? `Radicado: ${radicado}` : undefined,
      duration: UNDO_TIMEOUT_MS,
      action: {
        label: "Deshacer",
        onClick: performUndo,
      },
    });
  }, [performUndo]);

  const registerFilingToProcessUndo = useCallback((
    filingId: string,
    newProcessId: string | null,
    originalStatus: FilingStatus,
    originalHasAutoAdmisorio: boolean | null,
    originalLinkedProcessId: string | null,
    radicado: string | null
  ) => {
    pendingUndoRef.current = {
      type: "filing-to-process",
      filingId,
      newProcessId: newProcessId || undefined,
      originalFilingStatus: originalStatus,
      originalFilingHasAutoAdmisorio: originalHasAutoAdmisorio ?? false,
      originalFilingLinkedProcessId: originalLinkedProcessId,
    };
    showUndoToast(radicado);
  }, [showUndoToast]);

  const registerProcessToFilingUndo = useCallback((
    processId: string,
    newFilingId: string | null,
    originalPhase: ProcessPhase | null,
    originalHasAutoAdmisorio: boolean | null,
    originalLinkedFilingId: string | null,
    originalMonitoringEnabled: boolean,
    radicado: string | null
  ) => {
    pendingUndoRef.current = {
      type: "process-to-filing",
      processId,
      newFilingId: newFilingId || undefined,
      originalProcessPhase: originalPhase || "PENDIENTE_REGISTRO_MEDIDA_CAUTELAR",
      originalProcessHasAutoAdmisorio: originalHasAutoAdmisorio ?? true,
      originalProcessLinkedFilingId: originalLinkedFilingId,
      originalProcessMonitoringEnabled: originalMonitoringEnabled,
    };
    showUndoToast(radicado);
  }, [showUndoToast]);

  return {
    registerFilingToProcessUndo,
    registerProcessToFilingUndo,
    clearPendingUndo,
  };
}
