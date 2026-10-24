/**
 * manage-helpers.ts — shared pieces for the per-user management tools.
 * Import-safe: no env reads or I/O at module top level.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStageOrderForWorkflow,
  getStagesForWorkflow,
  type CGPPhase,
  type WorkflowType,
} from "../workflow-constants";

/** Application stage order for workflows whose stages are not DB-catalogued. */
export function appStageOrder(workflowType: string, cgpPhase?: string | null): string[] {
  return getStageOrderForWorkflow(workflowType as WorkflowType, (cgpPhase ?? undefined) as CGPPhase | undefined);
}

export function appStages(workflowType: string, cgpPhase?: string | null) {
  const stages = getStagesForWorkflow(workflowType as WorkflowType, (cgpPhase ?? undefined) as CGPPhase | undefined);
  return Object.entries(stages)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([code, s]) => ({ code, label: s.label, order: s.order }));
}

/** Loads the revision fields every stage/lifecycle write needs. */
export async function loadWorkItemRevision(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("work_items")
    .select("id, radicado, workflow_type, cgp_phase, stage, lifecycle_state, updated_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { item: null, error: error.message };
  if (!data) return { item: null, error: "Asunto no encontrado (o no pertenece a tu cuenta)." };
  return { item: data as Record<string, string | null>, error: null };
}

export const MANAGE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
