/**
 * Unified work item timeline (Línea procesal).
 *
 * Reads the server-side union view `work_item_timeline_v`, which merges
 * actuaciones, estados/publicaciones, confirmed email links, deadline
 * lifecycle and stage changes into a single shape.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TimelineKind = "ACTUACION" | "ESTADO" | "CORREO" | "TERMINO" | "ETAPA" | "CLASE";

export interface TimelineEntry {
  work_item_id: string;
  occurred_at: string | null;
  kind: TimelineKind;
  title: string;
  ref_id: string;
  meta: Record<string, unknown> | null;
}

export function useWorkItemTimeline(workItemId: string | undefined | null, limit = 60) {
  return useQuery({
    queryKey: ["work-item-timeline", workItemId, limit],
    queryFn: async (): Promise<TimelineEntry[]> => {
      if (!workItemId) return [];
      const { data, error } = await supabase
        .from("work_item_timeline_v" as never)
        .select("*")
        .eq("work_item_id", workItemId)
        .order("occurred_at", { ascending: false })
        .limit(limit);
      if (error) {
        console.error("[use-work-item-timeline]", error);
        throw error;
      }
      return (data ?? []) as unknown as TimelineEntry[];
    },
    enabled: !!workItemId,
    staleTime: 60_000,
  });
}
