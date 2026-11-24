import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PendingReviewEvent } from "@/lib/pending-review";

interface ReviewPage {
  events: {
    event_id: string;
    work_item_id: string;
    radicado: string | null;
    title: string | null;
    label: string | null;
    deadline_type: string | null;
    row_ids: string[];
  }[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface PendingReviewSummary {
  suggestedLinks: number;
  manualDeadlines: number;
  events: PendingReviewEvent[];
  ids: string[];
  total: number;
}

async function listReviewEvents(): Promise<PendingReviewEvent[]> {
  const events: PendingReviewEvent[] = [];
  let cursor: string | null = null;

  for (;;) {
    const { data, error } = await supabase.rpc("list_pending_deadline_reviews", {
      p_cursor: cursor,
      p_limit: 50,
    });
    if (error) throw error;
    const page = data as unknown as ReviewPage | null;
    if (!page || !Array.isArray(page.events)) throw new Error("No se pudo leer la bandeja de revisiones");

    for (const event of page.events) {
      events.push({
        key: event.event_id,
        work_item_id: event.work_item_id,
        radicado: event.radicado,
        title: event.title,
        label: event.label ?? event.deadline_type,
        deadline_type: event.deadline_type,
        ids: event.row_ids,
      });
    }
    if (!page.has_more) return events;
    if (!page.next_cursor || (cursor && page.next_cursor <= cursor)) {
      throw new Error("El cursor de revisiones no avanzó");
    }
    cursor = page.next_cursor;
  }
}

export function usePendingReviewSummary() {
  return useQuery({
    queryKey: ["pending-review-summary"],
    queryFn: async (): Promise<PendingReviewSummary> => {
      const [links, events] = await Promise.all([
        supabase
          .from("work_item_email_links")
          .select("id", { count: "exact", head: true })
          .eq("link_status", "SUGGESTED"),
        listReviewEvents(),
      ]);
      if (links.error) throw links.error;
      const ids = events.flatMap((event) => event.ids);
      const suggestedLinks = links.count ?? 0;
      return { suggestedLinks, manualDeadlines: ids.length, events, ids, total: suggestedLinks + events.length };
    },
    staleTime: 60_000,
  });
}
