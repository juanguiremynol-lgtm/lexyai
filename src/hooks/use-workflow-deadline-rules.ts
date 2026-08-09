/**
 * use-workflow-deadline-rules.ts — specialised deadline rules (iterations 31-32).
 *
 * One catalogue for the workflows whose terms do NOT anchor on fijación en
 * estado: PENAL_906 (hearing dates and procedural acts), LABORAL (two coexisting
 * regimes — CPTSS 1948 and Ley 2452 de 2025) and EJECUTIVO (CGP executive
 * process, including the art. 306 "ejecución a continuación" track).
 *
 * Every seeded rule starts as DRAFT and computes NOTHING until the lawyer
 * ratifies it — an unratified term rendered as a real deadline is the
 * iteration-11 failure mode.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UNSPECIFIED_DAY_TYPE_NOTE } from "@/lib/penal906/penal906-terms";

export { UNSPECIFIED_DAY_TYPE_NOTE };

export type DeadlineAnchorType =
  | "ANCHOR_AUDIENCIA"
  | "ANCHOR_ACTO"
  | "ANCHOR_NOTIFICACION"
  /**
   * Electronic personal notification (Ley 2452 de 2025, arts. 208/209). Two
   * stages: the notification is DEEMED effected two business days after the
   * message is sent, and the term runs from the day following the moment the
   * initiator receives, acknowledges or can otherwise verify delivery.
   */
  | "ANCHOR_NOTIFICACION_TIC"
  | "ANCHOR_EJECUTORIA"
  /**
   * Oral, in-hearing moment (CPTSS art. 66): the remedy is lodged and sustained
   * orally at the very act of notification in the hearing. There is no written
   * term, so the engine computes no date.
   */
  | "ANCHOR_ORAL_EN_AUDIENCIA";
/** @deprecated use DeadlineAnchorType */
export type PenalAnchorType = DeadlineAnchorType;

/**
 * NONE = no written term (oral, in-hearing).
 * UNSPECIFIED = the statute does not say whether the days are business or
 * calendar (iteration 41). Such a rule may be seeded and displayed but MAY NOT
 * be ratified and MUST NOT compute a date — guessing produces a wrong date with
 * the appearance of certainty.
 */
export type DeadlineDayType =
  | "BUSINESS"
  | "CALENDAR"
  | "MONTHS"
  | "YEARS"
  | "NONE"
  | "UNSPECIFIED";

export type RuleConfidence = "ALTA" | "MEDIA" | "BAJA";

/** How well the rule's text was checked against a primary source. */
export type RuleVerificationState =
  | "VERIFICADA_FUENTE_PRIMARIA"
  | "PENDIENTE_FUENTE_PRIMARIA"
  | "NO_VERIFICADA";

export type DeadlineRuleStatus = "DRAFT" | "RATIFIED" | "RETIRED";
/** @deprecated use DeadlineRuleStatus */
export type PenalRuleStatus = DeadlineRuleStatus;

export interface WorkflowDeadlineRule {
  id: string;
  organization_id: string | null;
  workflow_type: string;
  /** Coexisting legal regimes (labour). NULL when the workflow has only one. */
  regimen: string | null;
  /** Procedural track the rule belongs to (e.g. EJECUTIVO_A_CONTINUACION). */
  track_kind: string | null;
  deadline_type: string;
  label: string;
  citation: string | null;
  anchor_type: DeadlineAnchorType;
  anchor_event: string | null;
  days_amount: number;
  day_type: DeadlineDayType;
  description: string | null;
  /** Who the term binds (party or the judge), as free text. */
  bound_party?: string | null;
  /** Canonical party the term binds — drives attribution (iteration 50). */
  bound_party_role?: string | null;
  /** What happens when the term lapses (desierto, preclusión, ...). */
  consequence?: string | null;
  /** True when the term is the court's own internal deadline. */
  is_judge_side?: boolean;
  verification_state?: RuleVerificationState;
  /** Two norms fix different terms for the same act; never resolved silently. */
  antinomia_group?: string | null;
  antinomia_designated_rule_id?: string | null;
  antinomia_designated_by?: string | null;
  antinomia_designated_at?: string | null;
  confidence?: RuleConfidence | null;
  /** Upper bound when the norm fixes a range (e.g. 15 to 30 days). */
  days_amount_max?: number | null;
  /** Alternative day count under `variant_condition` (e.g. 120 with concurso). */
  variant_days_amount?: number | null;
  variant_condition?: string | null;
  /** Gate: rule applies only to this procedure variant (e.g. ABREVIADO). */
  procedure_variant?: string | null;
  research_notes: string | null;
  sources: unknown;
  requires_manual_review: boolean;
  status: DeadlineRuleStatus;
  ratified_at: string | null;
  ratified_by: string | null;
}
/** @deprecated use WorkflowDeadlineRule */
export type PenalDeadlineRule = WorkflowDeadlineRule;

export const ANCHOR_LABELS: Record<DeadlineAnchorType, string> = {
  ANCHOR_AUDIENCIA: "Fecha de audiencia",
  ANCHOR_ACTO: "Fecha de acto procesal",
  ANCHOR_NOTIFICACION: "Fecha de notificación",
  ANCHOR_NOTIFICACION_TIC: "Notificación electrónica (TIC)",
  ANCHOR_EJECUTORIA: "Ejecutoria de la providencia",
  ANCHOR_ORAL_EN_AUDIENCIA: "Momento oral en audiencia (sin término escrito)",
};
/** @deprecated use ANCHOR_LABELS */
export const PENAL_ANCHOR_LABELS = ANCHOR_LABELS;

export const RULE_WORKFLOW_LABELS: Record<string, string> = {
  PENAL_906: "Penal (Ley 906)",
  LABORAL: "Laboral",
  EJECUTIVO: "Ejecutivo (CGP)",
  CGP: "CGP",
};

export const REGIMEN_LABELS: Record<string, string> = {
  LABORAL_CPTSS_1948: "CPTSS 1948 (radicados antes del 2-abr-2026)",
  LABORAL_2452: "Ley 2452 de 2025 (radicados desde el 2-abr-2026)",
};

export const DAY_TYPE_LABELS: Record<DeadlineDayType, string> = {
  BUSINESS: "hábiles",
  CALENDAR: "calendario",
  MONTHS: "meses",
  YEARS: "años",
  NONE: "sin término escrito",
  UNSPECIFIED: "tipo de día no especificado",
};

/** A rule with an unspecified day type can never be ratified. */
export function dayTypeIsUnspecified(rule: Pick<WorkflowDeadlineRule, "day_type">): boolean {
  return rule.day_type === "UNSPECIFIED";
}

export function canRatifyRule(rule: WorkflowDeadlineRule): { ok: boolean; reason?: string } {
  if (dayTypeIsUnspecified(rule)) {
    return { ok: false, reason: `No ratificable: ${UNSPECIFIED_DAY_TYPE_NOTE}.` };
  }
  if (rule.verification_state && rule.verification_state !== "VERIFICADA_FUENTE_PRIMARIA") {
    return { ok: false, reason: "No ratificable: falta verificación contra fuente primaria." };
  }
  return { ok: true };
}

const TABLE = "workflow_deadline_rules";
const QUERY_KEY = ["workflow-deadline-rules"];

export function useWorkflowDeadlineRules(workflowType?: string) {
  return useQuery({
    queryKey: [...QUERY_KEY, workflowType ?? "ALL"],
    queryFn: async (): Promise<WorkflowDeadlineRule[]> => {
      let q = supabase.from(TABLE).select("*");
      if (workflowType) q = q.eq("workflow_type", workflowType);
      const { data, error } = await q
        .order("workflow_type", { ascending: true })
        .order("status", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as WorkflowDeadlineRule[];
    },
  });
}

/** @deprecated use useWorkflowDeadlineRules("PENAL_906") */
export function usePenalDeadlineRules() {
  return useWorkflowDeadlineRules("PENAL_906");
}

/** Ratified rules only — the ONLY rules the engine is allowed to compute with. */
export function useRatifiedDeadlineRules(workflowType?: string) {
  const query = useWorkflowDeadlineRules(workflowType);
  return {
    ...query,
    data: (query.data ?? []).filter((r) => r.status === "RATIFIED" && r.ratified_at),
  };
}

/** @deprecated use useRatifiedDeadlineRules("PENAL_906") */
export const useRatifiedPenalRules = () => useRatifiedDeadlineRules("PENAL_906");

export function useWorkflowDeadlineRuleActions() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WorkflowDeadlineRule> }) => {
      const { error } = await supabase
        .from(TABLE)
        .update(patch as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const ratify = useMutation({
    mutationFn: async (id: string) => {
      const { data: rule } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
      if (rule) {
        const check = canRatifyRule(rule as unknown as WorkflowDeadlineRule);
        if (!check.ok) throw new Error(check.reason);
      }
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from(TABLE)
        .update({
          status: "RATIFIED",
          ratified_at: new Date().toISOString(),
          ratified_by: auth.user?.id ?? null,
        } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const unratify = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ status: "DRAFT", ratified_at: null, ratified_by: null } as never)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { update, ratify, unratify };
}

/**
 * Designates which of two conflicting norms governs an antinomia group.
 * The decision is recorded on every rule of the group with its author and date;
 * an antinomy is never resolved silently.
 */
export function useAntinomiaDesignation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ group, ruleId }: { group: string; ruleId: string | null }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from(TABLE)
        .update({
          antinomia_designated_rule_id: ruleId,
          antinomia_designated_by: ruleId ? (auth.user?.id ?? null) : null,
          antinomia_designated_at: ruleId ? new Date().toISOString() : null,
        } as never)
        .eq("antinomia_group", group);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

/** @deprecated use useWorkflowDeadlineRuleActions */
export const usePenalDeadlineRuleActions = useWorkflowDeadlineRuleActions;
