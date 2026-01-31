/**
 * Stage Change Audit Library
 * 
 * Provides verifiable audit logging for all stage changes.
 * Distinguishes between:
 * - MANUAL_USER: User directly changed stage without suggestion
 * - SUGGESTION_APPLIED: User accepted a system suggestion
 * - SUGGESTION_OVERRIDE: User chose different stage when reviewing suggestion
 * 
 * This audit trail is designed for legal compliance verification.
 */

import { supabase } from "@/integrations/supabase/client";

export type StageChangeSource = 
  | 'MANUAL_USER'
  | 'SUGGESTION_APPLIED'
  | 'SUGGESTION_OVERRIDE'
  | 'IMPORT_INITIAL';

export interface StageChangeAuditParams {
  workItemId: string;
  organizationId: string;
  actorUserId: string;
  previousStage: string | null;
  previousCgpPhase: string | null;
  newStage: string;
  newCgpPhase: string | null;
  changeSource: StageChangeSource;
  suggestionId?: string;
  suggestionConfidence?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface StageAuditRecord {
  id: string;
  work_item_id: string;
  organization_id: string;
  actor_user_id: string;
  previous_stage: string | null;
  previous_cgp_phase: string | null;
  new_stage: string;
  new_cgp_phase: string | null;
  change_source: StageChangeSource;
  suggestion_id: string | null;
  suggestion_confidence: number | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Create a verifiable audit record for a stage change
 */
export async function createStageChangeAudit(
  params: StageChangeAuditParams
): Promise<{ success: boolean; auditId?: string; error?: string }> {
  try {
    // Use type assertion for the insert since types may not be regenerated yet
    const insertData = {
      work_item_id: params.workItemId,
      organization_id: params.organizationId,
      actor_user_id: params.actorUserId,
      previous_stage: params.previousStage,
      previous_cgp_phase: params.previousCgpPhase,
      new_stage: params.newStage,
      new_cgp_phase: params.newCgpPhase,
      change_source: params.changeSource,
      suggestion_id: params.suggestionId || null,
      suggestion_confidence: params.suggestionConfidence || null,
      reason: params.reason || null,
      metadata: params.metadata || {},
    };

    const { data, error } = await supabase
      .from('work_item_stage_audit' as any)
      .insert(insertData as any)
      .select('id')
      .single() as { data: { id: string } | null; error: Error | null };

    if (error) throw error;

    const auditId = data?.id;
    console.log(`[stage-audit] Created audit record: ${auditId} (source: ${params.changeSource})`);

    return { success: true, auditId };
  } catch (err) {
    console.error('[stage-audit] Failed to create audit record:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Update work_items with stage change tracking
 */
export async function updateWorkItemWithAudit(params: {
  workItemId: string;
  newStage: string;
  newCgpPhase: string | null;
  changeSource: StageChangeSource;
  suggestionId?: string;
  actorUserId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const updates: Record<string, unknown> = {
      stage: params.newStage,
      last_stage_change_source: params.changeSource,
      last_stage_change_at: new Date().toISOString(),
      last_stage_change_by_user_id: params.actorUserId,
      updated_at: new Date().toISOString(),
    };

    if (params.newCgpPhase) {
      updates.cgp_phase = params.newCgpPhase;
      updates.cgp_phase_source = params.changeSource === 'MANUAL_USER' ? 'MANUAL' : 'AUTO';
    }

    if (params.suggestionId) {
      updates.last_stage_suggestion_id = params.suggestionId;
    }

    const { error } = await supabase
      .from('work_items')
      .update(updates)
      .eq('id', params.workItemId);

    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error('[stage-audit] Failed to update work item:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Get stage change history for a work item (for compliance review)
 */
export async function getStageAuditHistory(
  workItemId: string
): Promise<StageAuditRecord[]> {
  try {
    const { data, error } = await supabase
      .from('work_item_stage_audit' as any)
      .select('*')
      .eq('work_item_id', workItemId)
      .order('created_at', { ascending: false }) as { data: StageAuditRecord[] | null; error: Error | null };

    if (error) throw error;

    return (data || []) as StageAuditRecord[];
  } catch (err) {
    console.error('[stage-audit] Failed to fetch audit history:', err);
    return [];
  }
}

/**
 * Generate a human-readable description of the change source
 */
export function getChangeSourceLabel(source: StageChangeSource): string {
  switch (source) {
    case 'MANUAL_USER':
      return 'Cambio manual por usuario';
    case 'SUGGESTION_APPLIED':
      return 'Sugerencia del sistema aceptada';
    case 'SUGGESTION_OVERRIDE':
      return 'Usuario seleccionó etapa diferente';
    case 'IMPORT_INITIAL':
      return 'Etapa inicial de importación';
    default:
      return source;
  }
}

/**
 * Check if a stage change was made by user action or system suggestion
 */
export function isUserInitiatedChange(source: StageChangeSource): boolean {
  return source !== 'IMPORT_INITIAL';
}

/**
 * Check if a stage change involved a system suggestion
 */
export function involvesSuggestion(source: StageChangeSource): boolean {
  return source === 'SUGGESTION_APPLIED' || source === 'SUGGESTION_OVERRIDE';
}
