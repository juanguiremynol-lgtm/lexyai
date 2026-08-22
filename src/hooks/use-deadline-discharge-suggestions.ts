/**
 * FF2 — deadline discharge suggestions.
 *
 * The matcher only ever proposes: a term is discharged when the lawyer
 * confirms the actuación that supposedly satisfied it. Rejecting is sticky —
 * the same actuación never re-suggests the same discharge.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DeadlineDischargeSuggestion {
  id: string;
  deadline_id: string;
  work_item_id: string;
  act_id: string | null;
  act_date: string | null;
  act_text: string | null;
  norma: string | null;
  discharge_label: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  created_at: string;
}

export function useDeadlineDischargeSuggestions(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["deadline-discharge-suggestions", workItemId],
    enabled: !!workItemId,
    staleTime: 60_000,
    queryFn: async (): Promise<DeadlineDischargeSuggestion[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("deadline_discharge_suggestions")
        .select("*")
        .eq("work_item_id", workItemId)
        .eq("status", "PENDING")
        .order("act_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DeadlineDischargeSuggestion[];
    },
  });
}

export function useDecideDischarge(workItemId: string | undefined | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ suggestionId, confirm }: { suggestionId: string; confirm: boolean }) => {
      const { error } = await supabase.rpc("decide_deadline_discharge", {
        p_suggestion_id: suggestionId,
        p_confirm: confirm,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deadline-discharge-suggestions", workItemId] });
      qc.invalidateQueries({ queryKey: ["work-item-deadlines", workItemId] });
    },
  });
}
