/**
 * Stage Suggestion Engine
 * 
 * Runs stage inference for all work_items affected by an estados import.
 * ALWAYS runs analysis regardless of whether estados are new or duplicates.
 * 
 * Features:
 * - Generates suggestions for all affected work_items
 * - Supports per-item apply/dismiss/override
 * - Creates process_events audit trail
 * - Works with both Excel import and future scrapers
 */

import { supabase } from "@/integrations/supabase/client";
import {
  inferWorkItemStageFromEstado,
  getStageLabelForInference,
  type StageInferenceResult,
  type StageConfidence,
} from "@/lib/workflows/estado-stage-inference";
import {
  getStagesForWorkflow,
  getStageLabel,
  type WorkflowType,
  type CGPPhase,
} from "@/lib/workflow-constants";

export type SuggestionSource = 'ICARUS_EXCEL' | 'SCRAPER' | 'CPNU' | 'MANUAL_REEVAL';

export interface StageSuggestion {
  work_item_id: string;
  radicado: string | null;
  title: string | null;
  workflow_type: WorkflowType;
  current_stage: string;
  current_cgp_phase: CGPPhase | null;
  current_stage_label: string;
  suggested_stage: string | null;
  suggested_cgp_phase: CGPPhase | null;
  suggested_stage_label: string | null;
  confidence: StageConfidence;
  reasoning: string;
  category: string;
  milestone_type: string | null;
  is_different: boolean;
  triggering_estado: {
    id: string;
    description: string;
    act_date: string | null;
  } | null;
  client_name: string | null;
}

export interface StageSuggestionRun {
  run_id: string;
  source: SuggestionSource;
  timestamp: string;
  work_items_analyzed: number;
  suggestions_generated: number;
  suggestions_with_changes: number;
  suggestions: StageSuggestion[];
}

/**
 * Run the suggestion engine for a list of work_item IDs
 * Called after estados ingestion (both new and duplicate scenarios)
 */
export async function runStageSuggestionEngine(
  workItemIds: string[],
  source: SuggestionSource,
  ownerId: string,
  organizationId?: string
): Promise<StageSuggestionRun> {
  const runId = crypto.randomUUID();
  const suggestions: StageSuggestion[] = [];

  // Get unique work_item_ids
  const uniqueIds = [...new Set(workItemIds)];

  for (const workItemId of uniqueIds) {
    // Fetch work_item details
    const { data: workItem, error: wiError } = await supabase
      .from('work_items')
      .select(`
        id,
        radicado,
        title,
        workflow_type,
        stage,
        cgp_phase,
        client_id,
        clients (id, name)
      `)
      .eq('id', workItemId)
      .maybeSingle();

    if (wiError || !workItem) continue;

    // Fetch the most recent estado for this work_item
    const { data: recentEstado } = await supabase
      .from('work_item_acts')
      .select('id, description, act_date, act_type, raw_data')
      .eq('work_item_id', workItemId)
      .order('act_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If no estado, skip this work_item
    if (!recentEstado) continue;

    // Run inference on the most recent estado
    const inference = inferWorkItemStageFromEstado({
      workflowType: workItem.workflow_type as WorkflowType,
      currentStage: workItem.stage,
      currentCgpPhase: workItem.cgp_phase as CGPPhase | null,
      actuacion: recentEstado.description || '',
      anotacion: (recentEstado.raw_data as any)?.anotacion,
      iniciaTermino: recentEstado.act_date,
      despacho: (recentEstado.raw_data as any)?.despacho,
    });

    // Get current stage label
    const currentStageLabel = getStageLabel(
      workItem.workflow_type as WorkflowType,
      workItem.stage,
      workItem.cgp_phase as CGPPhase | null
    );

    // Get suggested stage label
    const suggestedStageLabel = inference.suggestedStage
      ? getStageLabelForInference(
          workItem.workflow_type as WorkflowType,
          inference.suggestedStage,
          inference.suggestedCgpPhase
        )
      : null;

    // Check if suggestion differs from current
    const isDifferent = inference.suggestedStage !== null &&
      (inference.suggestedStage !== workItem.stage ||
        inference.suggestedCgpPhase !== workItem.cgp_phase);

    // Get client name
    const clientName = Array.isArray(workItem.clients) && workItem.clients.length > 0
      ? workItem.clients[0].name
      : (workItem.clients as any)?.name || null;

    suggestions.push({
      work_item_id: workItemId,
      radicado: workItem.radicado,
      title: workItem.title,
      workflow_type: workItem.workflow_type as WorkflowType,
      current_stage: workItem.stage,
      current_cgp_phase: workItem.cgp_phase as CGPPhase | null,
      current_stage_label: currentStageLabel,
      suggested_stage: inference.suggestedStage,
      suggested_cgp_phase: inference.suggestedCgpPhase,
      suggested_stage_label: suggestedStageLabel,
      confidence: inference.confidence,
      reasoning: inference.reasoning,
      category: inference.category,
      milestone_type: inference.milestoneType,
      is_different: isDifferent,
      triggering_estado: recentEstado ? {
        id: recentEstado.id,
        description: recentEstado.description,
        act_date: recentEstado.act_date,
      } : null,
      client_name: clientName,
    });
  }

  const run: StageSuggestionRun = {
    run_id: runId,
    source,
    timestamp: new Date().toISOString(),
    work_items_analyzed: uniqueIds.length,
    suggestions_generated: suggestions.length,
    suggestions_with_changes: suggestions.filter(s => s.is_different).length,
    suggestions,
  };

  // Create audit event for suggestions generation
  await createSuggestionAuditEvent(
    'STAGE_SUGGESTIONS_GENERATED',
    ownerId,
    organizationId,
    null,
    {
      run_id: runId,
      source,
      work_items_analyzed: run.work_items_analyzed,
      suggestions_generated: run.suggestions_generated,
      suggestions_with_changes: run.suggestions_with_changes,
    }
  );

  return run;
}

/**
 * Re-evaluate stage for a single work_item
 * Useful for manual "re-evaluate" button in WorkItemDetail
 */
export async function reEvaluateSingleWorkItem(
  workItemId: string,
  ownerId: string,
  organizationId?: string
): Promise<StageSuggestion | null> {
  const run = await runStageSuggestionEngine(
    [workItemId],
    'MANUAL_REEVAL',
    ownerId,
    organizationId
  );

  return run.suggestions[0] || null;
}

/**
 * Apply a stage suggestion (user confirmed)
 */
export async function applyStageSuggestion(
  suggestion: StageSuggestion,
  ownerId: string,
  organizationId?: string
): Promise<{ success: boolean; error?: string }> {
  if (!suggestion.suggested_stage) {
    return { success: false, error: 'No hay sugerencia de etapa para aplicar' };
  }

  try {
    const updateData: Record<string, unknown> = {
      stage: suggestion.suggested_stage,
      updated_at: new Date().toISOString(),
    };

    if (suggestion.suggested_cgp_phase) {
      updateData.cgp_phase = suggestion.suggested_cgp_phase;
      updateData.cgp_phase_source = 'AUTO';
    }

    const { error } = await supabase
      .from('work_items')
      .update(updateData)
      .eq('id', suggestion.work_item_id)
      .eq('owner_id', ownerId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Create audit event
    await createSuggestionAuditEvent(
      'STAGE_UPDATED_BY_SUGGESTION',
      ownerId,
      organizationId,
      suggestion.work_item_id,
      {
        old_stage: suggestion.current_stage,
        old_cgp_phase: suggestion.current_cgp_phase,
        new_stage: suggestion.suggested_stage,
        new_cgp_phase: suggestion.suggested_cgp_phase,
        confidence: suggestion.confidence,
        reasoning: suggestion.reasoning,
        category: suggestion.category,
        triggering_estado_id: suggestion.triggering_estado?.id,
        triggering_estado_description: suggestion.triggering_estado?.description,
      }
    );

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/**
 * Apply a manually selected stage (user override)
 */
export async function applyManualStageOverride(
  workItemId: string,
  selectedStage: string,
  selectedCgpPhase: CGPPhase | null,
  ownerId: string,
  organizationId?: string,
  originalSuggestion?: StageSuggestion
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = {
      stage: selectedStage,
      updated_at: new Date().toISOString(),
    };

    if (selectedCgpPhase) {
      updateData.cgp_phase = selectedCgpPhase;
      updateData.cgp_phase_source = 'MANUAL';
    }

    const { error } = await supabase
      .from('work_items')
      .update(updateData)
      .eq('id', workItemId)
      .eq('owner_id', ownerId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Create audit event
    await createSuggestionAuditEvent(
      'STAGE_UPDATED_BY_USER_OVERRIDE',
      ownerId,
      organizationId,
      workItemId,
      {
        old_stage: originalSuggestion?.current_stage,
        old_cgp_phase: originalSuggestion?.current_cgp_phase,
        new_stage: selectedStage,
        new_cgp_phase: selectedCgpPhase,
        suggested_stage: originalSuggestion?.suggested_stage,
        suggested_confidence: originalSuggestion?.confidence,
        user_overrode: true,
      }
    );

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/**
 * Dismiss suggestions (user declined)
 */
export async function dismissSuggestions(
  suggestions: StageSuggestion[],
  scope: 'SINGLE' | 'BULK',
  ownerId: string,
  organizationId?: string
): Promise<{ success: boolean }> {
  await createSuggestionAuditEvent(
    'STAGE_SUGGESTIONS_DISMISSED',
    ownerId,
    organizationId,
    null,
    {
      dismiss_scope: scope,
      count_dismissed: suggestions.length,
      work_item_ids: suggestions.map(s => s.work_item_id),
    }
  );

  return { success: true };
}

/**
 * Bulk apply all suggestions with changes
 */
export async function bulkApplySuggestions(
  suggestions: StageSuggestion[],
  ownerId: string,
  organizationId?: string
): Promise<{ applied: number; failed: number; errors: string[] }> {
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  // Only apply suggestions that have changes
  const suggestionsWithChanges = suggestions.filter(s => s.is_different && s.suggested_stage);

  for (const suggestion of suggestionsWithChanges) {
    const result = await applyStageSuggestion(suggestion, ownerId, organizationId);
    if (result.success) {
      applied++;
    } else {
      failed++;
      errors.push(`${suggestion.radicado || suggestion.work_item_id}: ${result.error}`);
    }
  }

  return { applied, failed, errors };
}

/**
 * Get available stages for override selection
 */
export function getAvailableStagesForOverride(
  workflowType: WorkflowType,
  cgpPhase?: CGPPhase | null
): { key: string; label: string }[] {
  const stages = getStagesForWorkflow(workflowType, cgpPhase || undefined);
  return Object.entries(stages).map(([key, value]) => ({
    key,
    label: value.label,
  }));
}

/**
 * Create audit event
 * Uses work_item_acts for audit trail since process_events requires filing_id
 */
async function createSuggestionAuditEvent(
  eventType: string,
  ownerId: string,
  _organizationId: string | undefined,
  workItemId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    // For bulk operations without a work_item, just log
    if (!workItemId) {
      console.log(`[StageSuggestionEngine] Audit event: ${eventType}`, metadata);
      return;
    }

    // Create audit entry in work_item_acts
    await supabase.from('work_item_acts').insert([{
      owner_id: ownerId,
      work_item_id: workItemId,
      act_date: new Date().toISOString().split('T')[0],
      description: buildEventSummary(eventType, metadata),
      act_type: eventType,
      source: 'STAGE_SUGGESTION_ENGINE',
      raw_data: JSON.parse(JSON.stringify(metadata)),
      hash_fingerprint: `audit_${eventType}_${workItemId}_${Date.now()}`,
    }]);
  } catch (err) {
    console.error('Failed to create audit event:', err);
  }
}

function buildEventSummary(eventType: string, metadata: Record<string, unknown>): string {
  switch (eventType) {
    case 'STAGE_SUGGESTIONS_GENERATED':
      return `Generadas ${metadata.suggestions_generated} sugerencias de etapa (${metadata.suggestions_with_changes} con cambios) desde ${metadata.source}`;
    case 'STAGE_UPDATED_BY_SUGGESTION':
      return `Etapa actualizada de ${metadata.old_stage} a ${metadata.new_stage} (confianza: ${metadata.confidence})`;
    case 'STAGE_UPDATED_BY_USER_OVERRIDE':
      return `Etapa actualizada manualmente a ${metadata.new_stage}`;
    case 'STAGE_SUGGESTIONS_DISMISSED':
      return `Descartadas ${metadata.count_dismissed} sugerencias (${metadata.dismiss_scope})`;
    default:
      return eventType;
  }
}
