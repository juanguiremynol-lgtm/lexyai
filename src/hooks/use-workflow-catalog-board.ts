/**
 * Fase 4 / C — catalog-driven board.
 *
 * Columns, allowed moves and card content all come from the database catalog
 * (`workflow_stages_global`, `workflow_stage_transitions`). Nothing here
 * hard-codes a stage: adding a stage in the catalog adds a column, and the
 * board never invents one.
 *
 * Attention (I2/B) is a *separate dimension* from stage: it is read from
 * `v_work_item_attention_conditions` and rendered as badges, never as columns.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LifecycleBand =
  | "EN_PREPARACION"
  | "EN_CURSO"
  | "ESPERANDO_CONTRAPARTE"
  | "REQUIERE_ACCION_DESPACHO"
  | "CONCLUIDO";

export interface CatalogStage {
  id: string;
  code: string;
  label: string;
  displayOrder: number;
  isTerminal: boolean;
  isProcedurallyLive: boolean;
  lifecycleBand: LifecycleBand | null;
  legalBasis: string | null;
}

export interface CatalogTransition {
  fromStageCode: string;
  toStageCode: string;
  allowedBySuggestion: boolean;
  requiresExplicitUserAction: boolean;
  isRegressionAllowed: boolean;
  legalBasis: string | null;
}

export interface AttentionCondition {
  workItemId: string;
  conditionType: string;
  severity: "INFO" | "WARNING" | "CRITICAL" | string;
  objectKind: string | null;
  objectId: string | null;
  referenceDate: string | null;
  resolutionMode: string | null;
  detail: string | null;
}

/** Lifecycle band → column tint. Bands are shared across workflows (B.3). */
export const BAND_COLOR: Record<LifecycleBand, string> = {
  EN_PREPARACION: "slate",
  EN_CURSO: "blue",
  ESPERANDO_CONTRAPARTE: "amber",
  REQUIERE_ACCION_DESPACHO: "violet",
  CONCLUIDO: "emerald",
};

export const BAND_LABEL: Record<LifecycleBand, string> = {
  EN_PREPARACION: "En preparación",
  EN_CURSO: "En curso",
  ESPERANDO_CONTRAPARTE: "Esperando contraparte",
  REQUIERE_ACCION_DESPACHO: "Requiere acción del despacho",
  CONCLUIDO: "Concluido",
};

export function useCatalogStages(workflowType: string | undefined) {
  return useQuery({
    queryKey: ["catalog-stages", workflowType],
    enabled: !!workflowType,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CatalogStage[]> => {
      const { data, error } = await supabase
        .from("workflow_stages_global")
        .select(
          "id, code, label, display_order, is_terminal, is_procedurally_live, lifecycle_band, legal_basis",
        )
        .eq("workflow_type", workflowType!)
        .eq("active", true)
        .order("display_order", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        code: r.code as string,
        label: r.label as string,
        displayOrder: r.display_order as number,
        isTerminal: r.is_terminal as boolean,
        isProcedurallyLive: r.is_procedurally_live as boolean,
        lifecycleBand: (r.lifecycle_band as LifecycleBand | null) ?? null,
        legalBasis: (r.legal_basis as string | null) ?? null,
      }));
    },
  });
}

export function useCatalogTransitions(workflowType: string | undefined) {
  return useQuery({
    queryKey: ["catalog-transitions", workflowType],
    enabled: !!workflowType,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CatalogTransition[]> => {
      const { data, error } = await supabase
        .from("workflow_stage_transitions")
        .select(
          "from_stage_code, to_stage_code, allowed_by_suggestion, requires_explicit_user_action, is_regression_allowed, legal_basis",
        )
        .eq("workflow_type", workflowType!)
        .eq("active", true);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fromStageCode: r.from_stage_code as string,
        toStageCode: r.to_stage_code as string,
        allowedBySuggestion: r.allowed_by_suggestion as boolean,
        requiresExplicitUserAction: r.requires_explicit_user_action as boolean,
        isRegressionAllowed: r.is_regression_allowed as boolean,
        legalBasis: (r.legal_basis as string | null) ?? null,
      }));
    },
  });
}

export function useAttentionConditions(workflowType?: string) {
  return useQuery({
    queryKey: ["attention-conditions", workflowType ?? "ALL"],
    staleTime: 60 * 1000,
    queryFn: async (): Promise<AttentionCondition[]> => {
      let q = supabase
        .from("v_work_item_attention_conditions" as never)
        .select("*");
      if (workflowType) q = q.eq("workflow_type", workflowType) as typeof q;
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        workItemId: r.work_item_id as string,
        conditionType: r.condition_type as string,
        severity: r.severity as string,
        objectKind: (r.object_kind as string | null) ?? null,
        objectId: (r.object_id as string | null) ?? null,
        referenceDate: (r.reference_date as string | null) ?? null,
        resolutionMode: (r.resolution_mode as string | null) ?? null,
        detail: (r.detail as string | null) ?? null,
      }));
    },
  });
}

export interface MoveVerdict {
  allowed: boolean;
  /** Spanish, user-facing. */
  reason: string;
  isRegression: boolean;
}

/**
 * Drag validation (C.3). Unknown moves are refused with the catalog's own
 * vocabulary; the board never silently "corrects" a drop.
 */
export function evaluateMove(
  transitions: CatalogTransition[],
  fromStageCode: string,
  toStageCode: string,
): MoveVerdict {
  if (fromStageCode === toStageCode) {
    return { allowed: false, reason: "La etapa no cambia.", isRegression: false };
  }
  const t = transitions.find(
    (x) => x.fromStageCode === fromStageCode && x.toStageCode === toStageCode,
  );
  if (!t) {
    return {
      allowed: false,
      reason: "El catálogo no contempla ese paso desde la etapa actual.",
      isRegression: false,
    };
  }
  if (t.isRegressionAllowed) {
    return { allowed: true, reason: t.legalBasis ?? "", isRegression: true };
  }
  return { allowed: true, reason: t.legalBasis ?? "", isRegression: false };
}
