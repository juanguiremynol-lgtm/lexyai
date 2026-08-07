/**
 * use-upstream-capability.ts — ITER43.
 *
 * Reads the live enrolment register (`upstream_workflow_capability`). If the
 * read fails we fall back to the compiled mirror in `upstream-capability.ts`,
 * which fails closed: an área we cannot vouch for is never enrollable.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fallbackCapabilities, type UpstreamCapability } from "@/lib/upstream-capability";

export function useUpstreamCapability() {
  return useQuery({
    queryKey: ["upstream-workflow-capability"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<UpstreamCapability[]> => {
      const { data, error } = await supabase
        .from("upstream_workflow_capability")
        .select("workflow_type, lifecycle_enrollable, term_detection");
      if (error || !data || data.length === 0) return fallbackCapabilities();
      return data as UpstreamCapability[];
    },
    placeholderData: fallbackCapabilities(),
  });
}
