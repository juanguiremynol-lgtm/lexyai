/**
 * Effect trail for email links: which término an email opened or satisfied,
 * which stage it suggested, or whether it offered an expediente link.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EmailEffectType =
  | "DEADLINE_OPENED"
  | "DEADLINE_SATISFIED"
  | "STAGE_SUGGESTED"
  | "EXPEDIENTE_LINK_OFFERED"
  /** ITER19 A2: non-actionable court notice ("Según correo del despacho…"). */
  | "NOTICIA_INFORMATIVA"
  /** ITER19 A3(ii): hearing citation received only by email. */
  | "HEARING_SUGGESTED";

export interface EmailLinkEffect {
  id: string;
  link_id: string;
  work_item_id: string;
  effect_type: EmailEffectType;
  target_table: string | null;
  target_id: string | null;
  label: string | null;
  created_at: string;
}

/** All effects for a work item, indexed by link_id. */
export function useEmailLinkEffects(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["email-link-effects", workItemId],
    queryFn: async (): Promise<Record<string, EmailLinkEffect[]>> => {
      if (!workItemId) return {};
      const { data, error } = await supabase
        .from("work_item_email_link_effects" as never)
        .select("*")
        .eq("work_item_id", workItemId);
      if (error) {
        console.error("[use-email-link-effects]", error);
        throw error;
      }
      const byLink: Record<string, EmailLinkEffect[]> = {};
      for (const row of (data ?? []) as unknown as EmailLinkEffect[]) {
        (byLink[row.link_id] ??= []).push(row);
      }
      return byLink;
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });
}
