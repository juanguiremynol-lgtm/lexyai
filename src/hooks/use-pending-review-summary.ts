/**
 * use-pending-review-summary — Counts the two silent queues that must never
 * be discovered by accident: email links awaiting confirmation and deadlines
 * the engine could not compute (REQUIERE_REVISION_MANUAL).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PendingReviewDeadline {
  id: string;
  work_item_id: string;
  label: string | null;
  deadline_type: string | null;
  trigger_date: string | null;
  work_items?: { id: string; radicado: string | null; title: string | null } | null;
}

export interface PendingReviewSummary {
  suggestedLinks: number;
  manualDeadlines: number;
  deadlines: PendingReviewDeadline[];
  total: number;
}

export function usePendingReviewSummary() {
  return useQuery({
    queryKey: ["pending-review-summary"],
    queryFn: async (): Promise<PendingReviewSummary> => {
      const [links, deadlines] = await Promise.all([
        supabase
          .from("work_item_email_links")
          .select("id", { count: "exact", head: true })
          .eq("link_status", "SUGGESTED"),
        supabase
          .from("work_item_deadlines")
          .select(
            "id, work_item_id, label, deadline_type, trigger_date, work_items(id, radicado, title)",
            { count: "exact" },
          )
          .eq("status", "REQUIERE_REVISION_MANUAL")
          .order("trigger_date", { ascending: false })
          .limit(10),
      ]);
      if (links.error) throw links.error;
      if (deadlines.error) throw deadlines.error;

      const suggestedLinks = links.count ?? 0;
      const manualDeadlines = deadlines.count ?? 0;
      return {
        suggestedLinks,
        manualDeadlines,
        deadlines: (deadlines.data ?? []) as unknown as PendingReviewDeadline[],
        total: suggestedLinks + manualDeadlines,
      };
    },
    staleTime: 60_000,
  });
}
