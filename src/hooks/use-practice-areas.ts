/**
 * use-practice-areas.ts — Tenant practice areas (iteration 18).
 *
 * `organizations.practice_areas` is NULL/empty for tenants that practise
 * everything. A workflow type absent from the list:
 *   (a) is never assigned by automatic inference,
 *   (b) has its kanban board hidden,
 *   (c) can still be set MANUALLY, which prompts adding the area.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { WorkflowType } from "@/lib/workflow-constants";

/** Areas that are boards, in display order. INDETERMINADO is not an area. */
export const PRACTICE_AREA_OPTIONS: WorkflowType[] = [
  "CGP",
  "EJECUTIVO",
  "LABORAL",
  "PENAL_906",
  "CPACA",
  "GOV_PROCEDURE",
  "PETICION",
  "TUTELA",
];

export function usePracticeAreas() {
  const { organization } = useOrganization();
  const orgId = organization?.id ?? null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["practice-areas", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("practice_areas")
        .eq("id", orgId!)
        .maybeSingle();
      if (error) throw error;
      const areas = (data?.practice_areas ?? null) as string[] | null;
      return areas && areas.length > 0 ? (areas as WorkflowType[]) : null;
    },
  });

  const areas = data ?? null; // null = all areas

  const addArea = useMutation({
    mutationFn: async (area: WorkflowType) => {
      if (!orgId) throw new Error("Organización no disponible");
      const next = Array.from(new Set([...(areas ?? PRACTICE_AREA_OPTIONS), area]));
      const { error } = await supabase
        .from("organizations")
        .update({ practice_areas: next })
        .eq("id", orgId);
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["practice-areas", orgId] });
    },
  });

  const setAreas = useMutation({
    mutationFn: async (next: WorkflowType[]) => {
      if (!orgId) throw new Error("Organización no disponible");
      const { error } = await supabase
        .from("organizations")
        .update({ practice_areas: next })
        .eq("id", orgId);
      if (error) throw error;
      return next;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["practice-areas", orgId] });
    },
  });

  return {
    areas,
    isLoading,
    /** True when the tenant practises this area (or practises everything). */
    isPracticed: (wf: WorkflowType) => !areas || areas.includes(wf),
    addArea,
    setAreas,
  };
}
