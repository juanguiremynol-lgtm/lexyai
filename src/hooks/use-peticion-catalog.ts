/**
 * Reads the PETICION catalog from the database (single source of truth).
 *
 * Fase 5 / A.1: there is no compiled fallback. If the catalog cannot be read,
 * or answers empty, the hook throws — the UI shows the fault instead of
 * inventing (or omitting) stages. The mirror in `src/lib/peticion/catalog.ts`
 * remains only as typed constants for the drift test.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { assertCatalogRows } from "@/lib/workflow/catalog-access";

export interface CatalogStageRow {
  id: string;
  code: string;
  label: string;
  display_order: number;
  is_terminal: boolean;
  is_procedurally_live: boolean;
  legal_basis: string | null;
}

export interface PeticionSubtypeRow {
  code: string;
  label: string;
  duration_value: number | null;
  duration_unit: string;
  term_class: string;
  legal_basis: string;
  requires_user_term: boolean;
  default_silence_effect: string;
}

export function usePeticionStages() {
  return useQuery({
    queryKey: ["workflow-stages", "PETICION"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<CatalogStageRow[]> => {
      const { data, error } = await supabase
        .from("workflow_stages_global")
        .select("id, code, label, display_order, is_terminal, is_procedurally_live, legal_basis")
        .eq("workflow_type", "PETICION")
        .eq("active", true)
        .order("display_order", { ascending: true });
      return assertCatalogRows("workflow_stages_global", data, error) as CatalogStageRow[];
    },
  });
}

export function usePeticionSubtypes() {
  return useQuery({
    queryKey: ["peticion-subtypes"],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<PeticionSubtypeRow[]> => {
      const { data, error } = await supabase
        .from("peticion_subtypes")
        .select(
          "code, label, duration_value, duration_unit, term_class, legal_basis, requires_user_term, default_silence_effect",
        )
        .eq("active", true)
        .order("display_order", { ascending: true });
      return assertCatalogRows("peticion_subtypes", data, error) as PeticionSubtypeRow[];
    },
  });
}
