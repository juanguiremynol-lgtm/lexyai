/**
 * use-pending-review-summary — Counts the two silent queues that must never
 * be discovered by accident: email links awaiting confirmation and deadlines
 * the engine could not compute (REQUIERE_REVISION_MANUAL).
 *
 * Deadline rows already acknowledged or snoozed by the current user are
 * excluded server-side state (deadline_review_user_state), so a drained
 * backlog never reappears on reload or after an identical sync; genuinely
 * new rows (new ids) still surface. Display groups rows by source event so
 * duplicate rows of the same event do not inflate the notice.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  groupDeadlineEvents,
  visibleDeadlineRows,
  type DeadlineReviewState,
  type PendingDeadlineRow,
  type PendingReviewEvent,
} from "@/lib/pending-review";

export type PendingReviewDeadline = PendingDeadlineRow;

export interface PendingReviewSummary {
  suggestedLinks: number;
  /** Visible rows after per-user filtering (raw count). */
  manualDeadlines: number;
  /** One entry per source event; duplicate rows share an entry. */
  events: PendingReviewEvent[];
  /** Every visible row id — acknowledgment marks them all. */
  ids: string[];
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
            "id, work_item_id, label, deadline_type, trigger_date, trigger_event, bound_party_role, source_event_id, work_items(id, radicado, title)",
          )
          .eq("status", "REQUIERE_REVISION_MANUAL")
          .order("trigger_date", { ascending: false })
          .limit(500),
      ]);
      if (links.error) throw links.error;
      if (deadlines.error) throw deadlines.error;

      const rows = (deadlines.data ?? []) as unknown as PendingDeadlineRow[];
      const ids = rows.map((r) => r.id);

      let states: DeadlineReviewState[] = [];
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from("deadline_review_user_state")
          .select("deadline_id, acknowledged_at, snoozed_until, event_key")
          .in("deadline_id", ids);
        if (error) throw error;
        states = (data ?? []) as DeadlineReviewState[];
      }

      const visible = visibleDeadlineRows(rows, states);
      const events = groupDeadlineEvents(visible);
      const suggestedLinks = links.count ?? 0;
      return {
        suggestedLinks,
        manualDeadlines: visible.length,
        events,
        ids: visible.map((r) => r.id),
        deadlines: visible,
        total: suggestedLinks + events.length,
      };
    },
    staleTime: 60_000,
  });
}
