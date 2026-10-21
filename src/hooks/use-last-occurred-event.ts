import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { splitOccurredAndScheduled, type TimelineLike } from "@/lib/last-occurred-event";

/** Latest ACTUACION/ESTADO actually stored for the work item (RLS-scoped). */
export function useLastOccurredEvent(workItemId: string | undefined | null) {
  return useQuery({
    queryKey: ["work-item-last-occurred", workItemId],
    enabled: !!workItemId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_item_timeline_v" as never)
        .select("occurred_at, kind, title")
        .eq("work_item_id", workItemId!)
        .in("kind", ["ACTUACION", "ESTADO"])
        .order("occurred_at", { ascending: false, nullsFirst: false })
        .limit(40);
      if (error) throw error;
      return splitOccurredAndScheduled((data ?? []) as unknown as TimelineLike[]);
    },
  });
}
