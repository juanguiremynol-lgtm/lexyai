/**
 * Reads the PETICION catalog from the database (single source of truth).
 * Falls back to the compiled mirror in `src/lib/peticion/catalog.ts` only if
 * the read fails, so the UI never invents stages.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PETICION_STAGES, PETICION_SUBTYPES } from "@/lib/peticion/catalog";

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
    queryFn: async (): Promise<CatalogStageRow[]> => {
      const { data, error } = await supabase
        .from("workflow_stages_global")
        .select("id, code, label, display_order, is_terminal, is_procedurally_live, legal_basis")
        .eq("workflow_type", "PETICION")
        .eq("active", true)
        .order("display_order", { ascending: true });
      if (error || !data || data.length === 0) {
        return PETICION_STAGES.map((s) => ({
          id: s.code,
          code: s.code,
          label: s.label,
          display_order: s.order,
          is_terminal: s.isTerminal,
          is_procedurally_live: !s.isTerminal,
          legal_basis: s.legalBasis,
        }));
      }
      return data as CatalogStageRow[];
    },
  });
}

export function usePeticionSubtypes() {
  return useQuery({
    queryKey: ["peticion-subtypes"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PeticionSubtypeRow[]> => {
      const { data, error } = await supabase
        .from("peticion_subtypes")
        .select(
          "code, label, duration_value, duration_unit, term_class, legal_basis, requires_user_term, default_silence_effect",
        )
        .eq("active", true)
        .order("display_order", { ascending: true });
      if (error || !data || data.length === 0) {
        return Object.values(PETICION_SUBTYPES).map((s) => ({
          code: s.code,
          label: s.label,
          duration_value: s.durationValue,
          duration_unit: s.durationUnit,
          term_class: s.termClass,
          legal_basis: s.legalBasis,
          requires_user_term: s.requiresUserTerm,
          default_silence_effect: s.defaultSilenceEffect,
        }));
      }
      return data as PeticionSubtypeRow[];
    },
  });
}
