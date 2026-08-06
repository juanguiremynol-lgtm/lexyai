/**
 * use-missing-rules.ts — REGLAS_FALTANTES register (iteration 40).
 *
 * Terms we know the law has but could not verify against a primary source.
 * Rendering them explicitly is what keeps "no rule modelled" distinguishable
 * from "this matter has no term".
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MissingRule {
  id: string;
  workflow_type: string;
  regimen: string | null;
  deadline_type: string;
  label: string;
  expected_citation: string | null;
  reason: string;
  kind: "PROCESAL" | "SUSTANCIAL";
  notes: string | null;
}

export function useMissingRules(workflowType?: string, regimen?: string | null) {
  return useQuery({
    queryKey: ["workflow-missing-rules", workflowType ?? "ALL", regimen ?? "ALL"],
    queryFn: async (): Promise<MissingRule[]> => {
      let q = supabase.from("workflow_missing_rules").select("*");
      if (workflowType) q = q.eq("workflow_type", workflowType);
      const { data, error } = await q.order("label", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as MissingRule[];
      if (!regimen) return rows;
      return rows.filter((r) => !r.regimen || r.regimen === regimen);
    },
  });
}
