/**
 * All PENDING stage suggestions for a work item (any source: actuación or correo).
 * Surfaced in the "Acción requerida" card of the Línea procesal section.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StageSuggestionRecord } from "@/hooks/useStageSuggestion";

export function usePendingStageSuggestions(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["pending-stage-suggestions", workItemId],
    queryFn: async (): Promise<StageSuggestionRecord[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("work_item_stage_suggestions")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("status", "PENDING")
        .order("confidence", { ascending: false });
      if (error) {
        console.error("[use-pending-stage-suggestions]", error);
        throw error;
      }
      return (data ?? []) as unknown as StageSuggestionRecord[];
    },
    enabled: !!workItemId,
    staleTime: 30_000,
  });
}
