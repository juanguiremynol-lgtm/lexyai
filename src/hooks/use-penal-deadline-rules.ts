/**
 * use-penal-deadline-rules.ts — Penal (Ley 906) deadline rules (iteration 31).
 *
 * Penal terms differ structurally from CGP: they anchor on HEARING DATES and
 * on procedural acts, not on fijación en estado. Every seeded rule starts as
 * DRAFT and computes NOTHING until the lawyer ratifies it — an unratified
 * penal term rendered as a real deadline is the iteration-11 failure mode.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PenalAnchorType = "ANCHOR_AUDIENCIA" | "ANCHOR_ACTO" | "ANCHOR_NOTIFICACION";
export type PenalRuleStatus = "DRAFT" | "RATIFIED" | "RETIRED";

export interface PenalDeadlineRule {
  id: string;
  organization_id: string | null;
  workflow_type: string;
  deadline_type: string;
  label: string;
  citation: string | null;
  anchor_type: PenalAnchorType;
  anchor_event: string | null;
  days_amount: number;
  day_type: "BUSINESS" | "CALENDAR";
  description: string | null;
  requires_manual_review: boolean;
  status: PenalRuleStatus;
  ratified_at: string | null;
  ratified_by: string | null;
}

export const PENAL_ANCHOR_LABELS: Record<PenalAnchorType, string> = {
  ANCHOR_AUDIENCIA: "Fecha de audiencia",
  ANCHOR_ACTO: "Fecha de acto procesal",
  ANCHOR_NOTIFICACION: "Fecha de notificación",
};

const QUERY_KEY = ["penal-deadline-rules"];

export function usePenalDeadlineRules() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<PenalDeadlineRule[]> => {
      const { data, error } = await supabase
        .from("penal_deadline_rules")
        .select("*")
        .order("status", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PenalDeadlineRule[];
    },
  });
}

/** Ratified rules only — the ONLY rules the engine is allowed to compute with. */
export function useRatifiedPenalRules() {
  const query = usePenalDeadlineRules();
  return {
    ...query,
    data: (query.data ?? []).filter((r) => r.status === "RATIFIED" && r.ratified_at),
  };
}

export function usePenalDeadlineRuleActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PenalDeadlineRule> }) => {
      const { error } = await supabase.from("penal_deadline_rules").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const ratify = useMutation({
    mutationFn: async (id: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("penal_deadline_rules")
        .update({
          status: "RATIFIED",
          ratified_at: new Date().toISOString(),
          ratified_by: auth.user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unratify = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("penal_deadline_rules")
        .update({ status: "DRAFT", ratified_at: null, ratified_by: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { update, ratify, unratify };
}
