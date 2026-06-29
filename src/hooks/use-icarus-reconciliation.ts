// Loads the ICARUS reconciliation batch and classifies each entry against the
// current work_items table by radicado.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ICARUS_RECONCILIATION_BATCH } from "@/lib/data/icarus-reconciliation-batch";
import type { ReconciledItem, WorkflowType } from "@/lib/icarus-reconciliation/types";

interface ReconciliationBuckets {
  faltantes: ReconciledItem[];
  divergentes: ReconciledItem[];
  yaExisten: ReconciledItem[];
}

export function useIcarusReconciliation() {
  return useQuery({
    queryKey: ["icarus-reconciliation"],
    queryFn: async (): Promise<ReconciliationBuckets> => {
      const radicados = ICARUS_RECONCILIATION_BATCH.map((b) => b.radicado);
      const { data, error } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, deleted_at")
        .in("radicado", radicados);
      if (error) throw error;

      const byRadicado = new Map<string, { id: string; workflow_type: WorkflowType }>();
      (data || []).forEach((row) => {
        if (row.deleted_at) return;
        if (!row.radicado) return;
        // Last-write-wins is fine here; we only need any existing match.
        byRadicado.set(row.radicado, { id: row.id, workflow_type: row.workflow_type });
      });

      const faltantes: ReconciledItem[] = [];
      const divergentes: ReconciledItem[] = [];
      const yaExisten: ReconciledItem[] = [];

      for (const item of ICARUS_RECONCILIATION_BATCH) {
        const existing = byRadicado.get(item.radicado);
        if (!existing) {
          faltantes.push({ ...item, status: "pendiente" });
        } else if (existing.workflow_type !== item.suggested_workflow_type) {
          divergentes.push({
            ...item,
            status: "divergente",
            existing_workflow_type: existing.workflow_type,
            existing_work_item_id: existing.id,
          });
        } else {
          yaExisten.push({
            ...item,
            status: "ya_existe",
            existing_workflow_type: existing.workflow_type,
            existing_work_item_id: existing.id,
          });
        }
      }

      return { faltantes, divergentes, yaExisten };
    },
    staleTime: 30_000,
  });
}