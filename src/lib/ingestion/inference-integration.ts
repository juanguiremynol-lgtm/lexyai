/**
 * Inference Integration Service
 * 
 * Wires the inference orchestrator into all ingestion paths:
 * - Estados ingestion (canonical for CGP/LABORAL)
 * - External provider sync (CPNU/SAMAI/TUTELAS/PUBLICACIONES)
 * 
 * Creates stage suggestions when inference confidence is not HIGH.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  inferStageFromNewEvent,
  type NormalizedInferenceInput,
  type EventSourceType,
  type StageInferenceOrchestrationResult,
} from "@/lib/workflows/inference-orchestrator";
import { createStageSuggestion } from "@/hooks/useStageSuggestion";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

// Gate 5: Inference logging controlled by env variable (silent in production)
const INFERENCE_DEBUG = import.meta.env.VITE_INFERENCE_DEBUG === 'true' || import.meta.env.DEV;
const log = (...args: unknown[]) => INFERENCE_DEBUG && console.log(...args);

// All inference results now require user approval (no auto-apply)
// Stage changes are created as PENDING suggestions regardless of confidence

interface WorkItemContext {
  id: string;
  organization_id: string;
  owner_id: string;
  workflow_type: WorkflowType;
  stage: string | null;
  cgp_phase: CGPPhase | null;
  pipeline_stage: number | null;
  stage_inference_enabled: boolean | null;
}

// Narrow source type to only those valid for NormalizedInferenceInput
type InferenceSourceType = 'ESTADO' | 'ACTUACION' | 'PUBLICACION' | 'TUTELA_EXPEDIENTE';

interface InferenceEvent {
  source_type: InferenceSourceType;
  text: string;
  date?: string | null;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

interface ProcessInferenceResult {
  inference: StageInferenceOrchestrationResult;
  action: 'AUTO_APPLIED' | 'SUGGESTION_CREATED' | 'NO_CHANGE' | 'SKIPPED';
  error?: string;
}

/**
 * Process a single event through inference and take appropriate action
 */
export async function processEventForInference(
  workItem: WorkItemContext,
  event: InferenceEvent
): Promise<ProcessInferenceResult> {
  try {
    // Check if inference is disabled for this work item
    if (workItem.stage_inference_enabled === false) {
      log('[Inference] Stage inference disabled for work item:', workItem.id);
      return {
        inference: {
          suggested_stage: null,
          suggested_cgp_phase: null,
          suggested_pipeline_stage: null,
          confidence: 'LOW',
          reasoning: 'Stage inference disabled for this work item',
          category: 'DISABLED',
          milestone_type: null,
          triggers_milestone: false,
          should_auto_apply: false,
          source_type: event.source_type,
          preclusion_decision: 'NO_SUGGESTION',
          preclusion_evidence: null,
          rollback_trigger: null,
          final_stage: null,
          final_cgp_phase: null,
        },
        action: 'SKIPPED',
      };
    }

    log('[Inference] Processing event:', {
      work_item_id: workItem.id,
      source_type: event.source_type,
      workflow_type: workItem.workflow_type,
      current_stage: workItem.stage,
      text_preview: event.text?.substring(0, 100),
    });

    // Build normalized input
    const input: NormalizedInferenceInput = {
      source_type: event.source_type,
      actuacion: event.text,
      descripcion: event.text,
      event_date: event.date,
      work_item_id: workItem.id,
      workflow_type: workItem.workflow_type,
    };

    // Run inference
    const inference = inferStageFromNewEvent(
      workItem.workflow_type,
      workItem.stage,
      workItem.cgp_phase,
      workItem.pipeline_stage,
      input
    );

    log('[Inference] Result:', {
      work_item_id: workItem.id,
      suggested_stage: inference.suggested_stage,
      confidence: inference.confidence,
      reasoning: inference.reasoning?.substring(0, 100),
    });

    // No suggestion = no change
    if (!inference.suggested_stage && !inference.suggested_pipeline_stage) {
      return {
        inference,
        action: 'NO_CHANGE',
      };
    }

    // Check if actually different
    const stageChanged = inference.suggested_stage && inference.suggested_stage !== workItem.stage;
    const pipelineChanged = inference.suggested_pipeline_stage !== null && 
      inference.suggested_pipeline_stage !== workItem.pipeline_stage;

    if (!stageChanged && !pipelineChanged) {
      return {
        inference,
        action: 'NO_CHANGE',
      };
    }

    // Determine confidence as number (0-1)
    const confidenceNum = inference.confidence === 'HIGH' ? 0.9 
      : inference.confidence === 'MEDIUM' ? 0.6 
      : 0.3;

    // ALL stage changes now require user approval - create PENDING suggestion
    log('[Inference] Creating PENDING suggestion (user approval required):', {
      workItemId: workItem.id,
      confidence: inference.confidence,
      suggested_stage: inference.suggested_stage,
    });

    // Create pending suggestion for user review
    const result = await createStageSuggestion({
      workItemId: workItem.id,
      organizationId: workItem.organization_id,
      ownerId: workItem.owner_id,
      sourceType: event.source_type,
      eventFingerprint: event.fingerprint,
      suggestedStage: inference.suggested_stage,
      suggestedCgpPhase: inference.suggested_cgp_phase,
      suggestedPipelineStage: inference.suggested_pipeline_stage,
      confidence: confidenceNum,
      reason: inference.reasoning,
    });

    if (!result.success) {
      log('[Inference] Failed to create suggestion:', result.error);
      return {
        inference,
        action: 'SKIPPED',
        error: result.error,
      };
    }

    // Check if it was a duplicate
    if (result.alreadyExists) {
      log('[Inference] Suggestion already exists (idempotent):', {
        workItemId: workItem.id,
        existingId: result.id,
      });
      return {
        inference,
        action: 'SKIPPED',
        error: 'Suggestion already exists',
      };
    }

    log('[Inference] 📋 Created PENDING stage suggestion:', {
      workItemId: workItem.id,
      suggestionId: result.id,
      confidence: inference.confidence,
      suggested_stage: inference.suggested_stage,
    });

    return {
      inference,
      action: 'SUGGESTION_CREATED',
    };

  } catch (err) {
    console.error('[processEventForInference] Error:', err);
    return {
      inference: {
        suggested_stage: null,
        suggested_cgp_phase: null,
        suggested_pipeline_stage: null,
        confidence: 'LOW',
        reasoning: 'Error during inference',
        category: 'ERROR',
        milestone_type: null,
        triggers_milestone: false,
        should_auto_apply: false,
        source_type: event.source_type,
        preclusion_decision: 'NO_SUGGESTION',
        preclusion_evidence: null,
        rollback_trigger: null,
        final_stage: null,
        final_cgp_phase: null,
      },
      action: 'SKIPPED',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Process multiple events for a work item
 * Used after bulk ingestion (e.g., Estados import, external sync)
 */
export async function processBatchEventsForInference(
  workItem: WorkItemContext,
  events: InferenceEvent[]
): Promise<ProcessInferenceResult[]> {
  const results: ProcessInferenceResult[] = [];

  // Process most recent event first (usually most relevant)
  const sortedEvents = [...events].sort((a, b) => {
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateB - dateA;
  });

  // Only process the most recent significant event to avoid spam
  let foundSignificant = false;
  
  for (const event of sortedEvents) {
    if (foundSignificant) {
      results.push({
        inference: {
          suggested_stage: null,
          suggested_cgp_phase: null,
          suggested_pipeline_stage: null,
          confidence: 'LOW',
          reasoning: 'Skipped - newer event already processed',
          category: 'SKIPPED',
          milestone_type: null,
          triggers_milestone: false,
          should_auto_apply: false,
          source_type: event.source_type,
          preclusion_decision: 'NO_SUGGESTION',
          preclusion_evidence: null,
          rollback_trigger: null,
          final_stage: null,
          final_cgp_phase: null,
        },
        action: 'SKIPPED',
      });
      continue;
    }

    const result = await processEventForInference(workItem, event);
    results.push(result);

    // If we took action, mark as significant
    if (result.action === 'AUTO_APPLIED' || result.action === 'SUGGESTION_CREATED') {
      foundSignificant = true;
    }
  }

  return results;
}

/**
 * Integration hook for Estados ingestion
 * Called after new estados are inserted into work_item_acts
 */
export async function processEstadosForInference(
  workItemId: string,
  newEstados: Array<{
    text: string;
    date: string | null;
    fingerprint: string;
  }>
): Promise<ProcessInferenceResult[]> {
  // Fetch work item context including stage_inference_enabled
  const { data: workItem, error } = await supabase
    .from('work_items')
    .select('id, organization_id, owner_id, workflow_type, stage, cgp_phase, pipeline_stage, stage_inference_enabled')
    .eq('id', workItemId)
    .single();

  if (error || !workItem) {
    console.error('[processEstadosForInference] Work item not found:', workItemId);
    return [];
  }

  const events: InferenceEvent[] = newEstados.map(e => ({
    source_type: 'ESTADO' as const,
    text: e.text,
    date: e.date,
    fingerprint: e.fingerprint,
  }));

  return processBatchEventsForInference(workItem as WorkItemContext, events);
}

/**
 * Integration hook for external provider sync
 * Called after new actuaciones/publicaciones are synced
 */
export async function processExternalSyncForInference(
  workItemId: string,
  provider: 'CPNU' | 'SAMAI' | 'TUTELAS' | 'PUBLICACIONES',
  newEvents: Array<{
    text: string;
    date: string | null;
    fingerprint: string;
  }>
): Promise<ProcessInferenceResult[]> {
  // Fetch work item context including stage_inference_enabled
  const { data: workItem, error } = await supabase
    .from('work_items')
    .select('id, organization_id, owner_id, workflow_type, stage, cgp_phase, pipeline_stage, stage_inference_enabled')
    .eq('id', workItemId)
    .single();

  if (error || !workItem) {
    console.error('[processExternalSyncForInference] Work item not found:', workItemId);
    return [];
  }

  // Map provider to source type (only use types that are valid for InferenceEvent)
  const sourceTypeMap: Record<string, 'ESTADO' | 'ACTUACION' | 'PUBLICACION' | 'TUTELA_EXPEDIENTE'> = {
    CPNU: 'ACTUACION',
    SAMAI: 'ACTUACION',
    TUTELAS: 'TUTELA_EXPEDIENTE',
    PUBLICACIONES: 'PUBLICACION',
  };

  const events: InferenceEvent[] = newEvents.map(e => ({
    source_type: sourceTypeMap[provider] || 'ACTUACION',
    text: e.text,
    date: e.date,
    fingerprint: e.fingerprint,
  }));

  return processBatchEventsForInference(workItem as WorkItemContext, events);
}
