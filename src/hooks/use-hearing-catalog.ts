/**
 * React Query hooks for reading the hearing catalog (types + flow templates)
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HearingType {
  id: string;
  jurisdiction: string;
  process_subtype: string | null;
  name: string;
  short_name: string;
  aliases: string[];
  description: string | null;
  legal_basis: string | null;
  default_stage_order: number;
  typical_purpose: string | null;
  typical_outputs: string[];
  typical_duration_minutes: number | null;
  is_mandatory: boolean;
  is_active: boolean;
  needs_admin_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface HearingFlowTemplate {
  id: string;
  jurisdiction: string;
  process_subtype: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  version: number;
  created_at: string;
}

export interface HearingFlowTemplateStep {
  id: string;
  flow_template_id: string;
  hearing_type_id: string;
  step_order: number;
  is_checkpoint: boolean;
  checkpoint_label: string | null;
  is_optional: boolean;
  notes: string | null;
  hearing_type?: HearingType;
}

export function useHearingTypes(jurisdiction?: string) {
  return useQuery({
    queryKey: ["hearing-types", jurisdiction],
    queryFn: async () => {
      let query = supabase
        .from("hearing_types")
        .select("*")
        .eq("is_active", true)
        .order("default_stage_order", { ascending: true });

      if (jurisdiction) {
        query = query.eq("jurisdiction", jurisdiction);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HearingType[];
    },
  });
}

export function useAllHearingTypes() {
  return useQuery({
    queryKey: ["hearing-types-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hearing_types")
        .select("*")
        .order("jurisdiction")
        .order("default_stage_order", { ascending: true });

      if (error) throw error;
      return (data || []) as HearingType[];
    },
  });
}

export function useHearingFlowTemplates(jurisdiction?: string) {
  return useQuery({
    queryKey: ["hearing-flow-templates", jurisdiction],
    queryFn: async () => {
      let query = supabase
        .from("hearing_flow_templates")
        .select("*")
        .eq("is_active", true)
        .order("jurisdiction");

      if (jurisdiction) {
        query = query.eq("jurisdiction", jurisdiction);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as HearingFlowTemplate[];
    },
  });
}

export function useFlowTemplateSteps(templateId: string | undefined) {
  return useQuery({
    queryKey: ["hearing-flow-steps", templateId],
    queryFn: async () => {
      if (!templateId) return [];

      const { data, error } = await supabase
        .from("hearing_flow_template_steps")
        .select("*, hearing_types(*)")
        .eq("flow_template_id", templateId)
        .order("step_order", { ascending: true });

      if (error) throw error;
      return (data || []).map((s: any) => ({
        ...s,
        hearing_type: s.hearing_types || undefined,
      })) as HearingFlowTemplateStep[];
    },
    enabled: !!templateId,
  });
}

export const JURISDICTION_LABELS: Record<string, string> = {
  CGP: "Civil General (CGP)",
  CPACA: "Administrativo (CPACA)",
  TUTELA: "Tutela",
  LABORAL: "Laboral",
  PENAL_906: "Penal (Ley 906)",
};

export const JURISDICTIONS = ["CGP", "CPACA", "PENAL_906", "LABORAL", "TUTELA"] as const;
