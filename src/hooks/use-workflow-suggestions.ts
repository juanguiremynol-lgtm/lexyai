/**
 * use-workflow-suggestions.ts — ITER42.
 *
 * The provider's clase de proceso may disagree with the área the matter is
 * filed under. GUARD B forbids rewriting it; the disagreement becomes a
 * pending suggestion the lawyer accepts or rejects. Nothing here writes
 * workflow_type directly — acceptance goes through accept_workflow_suggestion,
 * which stamps the change as MANUAL and audits it.
 *
 * ITER43: acceptance no longer calls the RPC from the browser. Upstream keys
 * monitoring by workflow_type and rejects áreas outside its allow-list with a
 * 400, so a reclassification that is not confirmed upstream would silently
 * unsubscribe the matter. The accept-workflow-suggestion edge function re-enrols
 * first, verifies, and only then commits — rolling back if the commit fails.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface WorkflowSuggestion {
  id: string;
  work_item_id: string;
  current_workflow_type: string | null;
  suggested_workflow_type: string;
  clase_proceso: string | null;
  label: string | null;
  reason: string | null;
  created_at: string;
  radicado: string | null;
  title: string | null;
}

export function useWorkflowSuggestions(workItemId?: string) {
  return useQuery({
    queryKey: ["workflow-suggestions", workItemId ?? "all"],
    queryFn: async (): Promise<WorkflowSuggestion[]> => {
      let query = supabase
        .from("work_item_workflow_suggestions")
        .select(
          "id, work_item_id, current_workflow_type, suggested_workflow_type, clase_proceso, label, reason, created_at, work_items(radicado, title)",
        )
        .eq("status", "PENDING")
        .order("created_at", { ascending: false });
      if (workItemId) query = query.eq("work_item_id", workItemId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        work_item_id: r.work_item_id as string,
        current_workflow_type: (r.current_workflow_type as string) ?? null,
        suggested_workflow_type: r.suggested_workflow_type as string,
        clase_proceso: (r.clase_proceso as string) ?? null,
        label: (r.label as string) ?? null,
        reason: (r.reason as string) ?? null,
        created_at: r.created_at as string,
        radicado: ((r.work_items as { radicado?: string } | null)?.radicado) ?? null,
        title: ((r.work_items as { title?: string } | null)?.title) ?? null,
      }));
    },
  });
}

export function useResolveWorkflowSuggestion() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workflow-suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["work-items"] });
    queryClient.invalidateQueries({ queryKey: ["work-items-phase-board"] });
    queryClient.invalidateQueries({ queryKey: ["work-items-cgp-pipeline"] });
  };

  const accept = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke(
        "accept-workflow-suggestion",
        { body: { suggestion_id: id } },
      );
      if (error) {
        const payload = (data ?? null) as { error?: string } | null;
        throw new Error(payload?.error || error.message);
      }
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(result?.error || "No se pudo aplicar la sugerencia");
    },
    onSuccess: () => {
      toast.success("Área actualizada");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo aplicar la sugerencia"),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("work_item_workflow_suggestions")
        .update({ status: "REJECTED", resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sugerencia descartada");
      invalidate();
    },
    onError: () => toast.error("No se pudo descartar la sugerencia"),
  });

  return { accept, reject };
}
