/**
 * Estados Ingestion Service
 * 
 * Specialized ingestion pipeline for Estados Excel imports and future scraper data.
 * Creates work_item_acts records and updates work_item stages/phases.
 * 
 * FEATURES:
 * - Deterministic stage inference from actuacion content
 * - Idempotent deduplication (no errors on re-upload)
 * - Shared entry point for both Excel import and scraper ingestion
 * - Audit trail via process_events
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeRadicadoInput } from "@/lib/radicado-utils";
import type { MatchedEstadosRow } from "@/lib/estados-matching";
import { 
  inferWorkItemStageFromEstado, 
  shouldAutoApplyStageChange,
  type StageInferenceResult,
  type StageConfidence,
} from "@/lib/workflows/estado-stage-inference";
import type { WorkflowType, CGPPhase } from "@/lib/workflow-constants";

export type EstadoImportStatus = 'IMPORTED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_UNLINKED' | 'FAILED';

export interface EstadoImportRowResult {
  radicado: string;
  work_item_id: string | null;
  status: EstadoImportStatus;
  reason?: string;
  act_id?: string;
  milestone_detected?: string;
  stage_updated?: boolean;
  phase_updated?: boolean;
  suggested_stage?: string | null;
  suggested_confidence?: StageConfidence;
  auto_applied?: boolean;
}

export interface EstadosImportResult {
  run_id: string;
  total: number;
  imported: number;
  skipped_duplicate: number;
  skipped_unlinked: number;
  failed: number;
  milestones_detected: number;
  phase_updates: number;
  stage_updates: number;
  row_results: EstadoImportRowResult[];
}

/**
 * Input for the shared ingestion entry point
 * Can be used by both Excel import and scraper
 */
export interface EstadoSnapshotInput {
  organization_id?: string;
  owner_id: string;
  radicado_raw: string;
  actuacion: string;
  anotacion?: string;
  inicia_termino?: string | null;
  fecha_inicia_termino?: string | null;
  despacho?: string;
  demandantes?: string;
  demandados?: string;
  source: 'ICARUS_ESTADOS' | 'SCRAPER' | 'CPNU' | 'MANUAL';
  source_reference?: string;
  all_columns?: Record<string, string>;
}

export interface EstadoIngestionResult {
  success: boolean;
  work_item_id: string | null;
  act_id: string | null;
  status: 'CREATED' | 'UPDATED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_NO_MATCH' | 'FAILED';
  reason?: string;
  inference: StageInferenceResult | null;
  stage_applied: boolean;
  phase_applied: boolean;
}

/**
 * Compute deterministic fingerprint for deduplication
 * Uses SHA-like hash for consistency
 */
function computeEstadoFingerprint(
  workItemId: string,
  actDate: string | null,
  description: string
): string {
  const data = `${workItemId}|${actDate || 'null'}|${description.trim().toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `est_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}

/**
 * Extended fingerprint including term date for more precise dedup
 */
function computeExtendedFingerprint(
  ownerId: string,
  radicado: string,
  iniciaTermino: string | null,
  actuacion: string,
  anotacion: string | undefined
): string {
  const data = [
    ownerId,
    radicado,
    iniciaTermino || '',
    (actuacion || '').trim().toLowerCase(),
    (anotacion || '').trim().toLowerCase(),
  ].join('|');
  
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `estado_${Math.abs(hash).toString(16).padStart(12, '0')}`;
}

/**
 * Build a descriptive summary from estado row
 */
function buildEstadoSummary(actuacion: string, anotacion?: string): string {
  const parts: string[] = [];
  
  if (actuacion) {
    parts.push(actuacion);
  }
  
  if (anotacion && anotacion !== actuacion) {
    parts.push(anotacion);
  }
  
  return parts.join(' - ') || 'Estado electrónico';
}

/**
 * SHARED INGESTION ENTRY POINT
 * 
 * Use this function from both:
 * - Excel import (today)
 * - Scraper ingestion (future)
 * 
 * It handles:
 * - Radicado normalization
 * - Work item lookup
 * - Deduplication
 * - Stage inference
 * - Work item updates
 * - Audit trail
 */
export async function ingestEstadoSnapshot(
  input: EstadoSnapshotInput
): Promise<EstadoIngestionResult> {
  // 1. Normalize radicado
  const radicadoNorm = normalizeRadicadoInput(input.radicado_raw);
  
  if (!radicadoNorm || radicadoNorm.length !== 23) {
    return {
      success: false,
      work_item_id: null,
      act_id: null,
      status: 'FAILED',
      reason: `Radicado inválido: ${radicadoNorm.length} dígitos (se requieren 23)`,
      inference: null,
      stage_applied: false,
      phase_applied: false,
    };
  }
  
  // 2. Find matching work_item
  const { data: workItem, error: findError } = await supabase
    .from('work_items')
    .select('id, workflow_type, stage, cgp_phase, authority_name, last_action_date')
    .eq('owner_id', input.owner_id)
    .eq('radicado', radicadoNorm)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  
  if (findError) {
    return {
      success: false,
      work_item_id: null,
      act_id: null,
      status: 'FAILED',
      reason: `Error buscando work_item: ${findError.message}`,
      inference: null,
      stage_applied: false,
      phase_applied: false,
    };
  }
  
  if (!workItem) {
    return {
      success: false,
      work_item_id: null,
      act_id: null,
      status: 'SKIPPED_NO_MATCH',
      reason: 'No existe work_item con este radicado',
      inference: null,
      stage_applied: false,
      phase_applied: false,
    };
  }
  
  // 3. Build summary and fingerprint
  const summary = buildEstadoSummary(input.actuacion, input.anotacion);
  const fingerprint = computeExtendedFingerprint(
    input.owner_id,
    radicadoNorm,
    input.inicia_termino || input.fecha_inicia_termino || null,
    input.actuacion,
    input.anotacion
  );
  
  // 4. Check for duplicate
  const { data: existing } = await supabase
    .from('work_item_acts')
    .select('id')
    .eq('hash_fingerprint', fingerprint)
    .maybeSingle();
  
  if (existing) {
    return {
      success: true,
      work_item_id: workItem.id,
      act_id: existing.id,
      status: 'SKIPPED_DUPLICATE',
      reason: 'Este estado ya fue importado anteriormente',
      inference: null,
      stage_applied: false,
      phase_applied: false,
    };
  }
  
  // 5. Run stage inference
  const inference = inferWorkItemStageFromEstado({
    workflowType: workItem.workflow_type as WorkflowType,
    currentStage: workItem.stage,
    currentCgpPhase: workItem.cgp_phase as CGPPhase | null,
    actuacion: input.actuacion,
    anotacion: input.anotacion,
    iniciaTermino: input.inicia_termino || input.fecha_inicia_termino,
    despacho: input.despacho,
  });
  
  // 6. Determine if should auto-apply stage change
  const shouldAutoApply = shouldAutoApplyStageChange(
    inference,
    workItem.workflow_type as WorkflowType,
    workItem.stage,
    workItem.cgp_phase as CGPPhase | null
  );
  
  // 7. Create work_item_act record
  const actDate = input.inicia_termino || input.fecha_inicia_termino || null;
  
  const { data: act, error: actError } = await supabase
    .from('work_item_acts')
    .insert({
      owner_id: input.owner_id,
      work_item_id: workItem.id,
      act_date: actDate,
      act_date_raw: input.inicia_termino || undefined,
      description: summary,
      act_type: inference.milestoneType || 'ESTADO',
      source: input.source,
      source_reference: input.source_reference,
      raw_data: {
        ...input.all_columns,
        despacho: input.despacho,
        demandantes: input.demandantes,
        demandados: input.demandados,
        inference_result: {
          suggestedStage: inference.suggestedStage,
          suggestedCgpPhase: inference.suggestedCgpPhase,
          confidence: inference.confidence,
          category: inference.category,
          reasoning: inference.reasoning,
          auto_applied: shouldAutoApply,
        },
      },
      hash_fingerprint: fingerprint,
    })
    .select('id')
    .single();
  
  if (actError) {
    return {
      success: false,
      work_item_id: workItem.id,
      act_id: null,
      status: 'FAILED',
      reason: `Error creando act: ${actError.message}`,
      inference,
      stage_applied: false,
      phase_applied: false,
    };
  }
  
  // 8. Update work_item
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  
  // Update last action info
  if (actDate) {
    // Only update if this is more recent
    if (!workItem.last_action_date || actDate > workItem.last_action_date) {
      updateData.last_action_date = actDate;
      updateData.last_action_description = summary;
    }
  }
  
  // Update authority if missing
  if (input.despacho && !workItem.authority_name) {
    updateData.authority_name = input.despacho;
  }
  
  // Apply stage/phase changes if auto-apply
  let stageApplied = false;
  let phaseApplied = false;
  
  if (shouldAutoApply) {
    if (inference.suggestedStage) {
      updateData.stage = inference.suggestedStage;
      stageApplied = true;
    }
    
    if (inference.suggestedCgpPhase && workItem.cgp_phase !== inference.suggestedCgpPhase) {
      updateData.cgp_phase = inference.suggestedCgpPhase;
      updateData.cgp_phase_source = 'AUTO';
      phaseApplied = true;
      
      // If AUTO_ADMISORIO, set the date
      if (inference.milestoneType === 'AUTO_ADMISORIO' && actDate) {
        updateData.auto_admisorio_date = actDate;
      }
    }
  }
  
  await supabase
    .from('work_items')
    .update(updateData)
    .eq('id', workItem.id);
  
  return {
    success: true,
    work_item_id: workItem.id,
    act_id: act.id,
    status: 'CREATED',
    inference,
    stage_applied: stageApplied,
    phase_applied: phaseApplied,
  };
}

/**
 * Process a batch of matched estados rows (from Excel import)
 * 
 * Uses the shared ingestEstadoSnapshot internally
 */
export async function processEstadosBatch(
  rows: MatchedEstadosRow[],
  runId: string,
  ownerId: string
): Promise<EstadosImportResult> {
  const results: EstadoImportRowResult[] = [];
  let imported = 0;
  let skippedDuplicate = 0;
  let skippedUnlinked = 0;
  let failed = 0;
  let milestonesDetected = 0;
  let phaseUpdates = 0;
  let stageUpdates = 0;

  for (const row of rows) {
    // Skip rows that weren't matched during preview
    if (!row.matched_work_item_id) {
      results.push({
        radicado: row.radicado_norm,
        work_item_id: null,
        status: 'SKIPPED_UNLINKED',
        reason: 'No existe work_item con este radicado',
      });
      skippedUnlinked++;
      continue;
    }

    // Use the shared ingestion function
    const ingestionResult = await ingestEstadoSnapshot({
      owner_id: ownerId,
      radicado_raw: row.radicado_norm,
      actuacion: row.actuacion,
      anotacion: row.anotacion,
      inicia_termino: row.fecha_ultima_actuacion_raw,
      fecha_inicia_termino: row.fecha_inicia_termino,
      despacho: row.despacho,
      demandantes: row.demandantes,
      demandados: row.demandados,
      source: 'ICARUS_ESTADOS',
      source_reference: runId,
      all_columns: row.all_columns,
    });

    // Map result to row result
    const rowResult: EstadoImportRowResult = {
      radicado: row.radicado_norm,
      work_item_id: ingestionResult.work_item_id,
      status: mapIngestionStatus(ingestionResult.status),
      reason: ingestionResult.reason,
      act_id: ingestionResult.act_id || undefined,
      milestone_detected: ingestionResult.inference?.milestoneType || undefined,
      stage_updated: ingestionResult.stage_applied,
      phase_updated: ingestionResult.phase_applied,
      suggested_stage: ingestionResult.inference?.suggestedStage,
      suggested_confidence: ingestionResult.inference?.confidence,
      auto_applied: ingestionResult.stage_applied || ingestionResult.phase_applied,
    };

    results.push(rowResult);

    // Update counters
    switch (ingestionResult.status) {
      case 'CREATED':
        imported++;
        if (ingestionResult.inference?.milestoneType) {
          milestonesDetected++;
        }
        if (ingestionResult.phase_applied) {
          phaseUpdates++;
        }
        if (ingestionResult.stage_applied) {
          stageUpdates++;
        }
        break;
      case 'SKIPPED_DUPLICATE':
        skippedDuplicate++;
        break;
      case 'SKIPPED_NO_MATCH':
        skippedUnlinked++;
        break;
      case 'FAILED':
        failed++;
        break;
    }
  }

  return {
    run_id: runId,
    total: rows.length,
    imported,
    skipped_duplicate: skippedDuplicate,
    skipped_unlinked: skippedUnlinked,
    failed,
    milestones_detected: milestonesDetected,
    phase_updates: phaseUpdates,
    stage_updates: stageUpdates,
    row_results: results,
  };
}

/**
 * Map internal status to import status
 */
function mapIngestionStatus(
  status: 'CREATED' | 'UPDATED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_NO_MATCH' | 'FAILED'
): EstadoImportStatus {
  switch (status) {
    case 'CREATED':
    case 'UPDATED':
      return 'IMPORTED';
    case 'SKIPPED_DUPLICATE':
      return 'SKIPPED_DUPLICATE';
    case 'SKIPPED_NO_MATCH':
      return 'SKIPPED_UNLINKED';
    case 'FAILED':
      return 'FAILED';
  }
}

/**
 * Apply a stage suggestion manually (user override)
 * 
 * Called when user clicks "Apply" on a suggested stage
 */
export async function applyManualStageUpdate(
  workItemId: string,
  suggestedStage: string,
  suggestedCgpPhase: CGPPhase | null,
  userId: string,
  sourceActId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const updateData: Record<string, unknown> = {
      stage: suggestedStage,
      updated_at: new Date().toISOString(),
    };
    
    if (suggestedCgpPhase) {
      updateData.cgp_phase = suggestedCgpPhase;
      updateData.cgp_phase_source = 'MANUAL';
    }
    
    const { error } = await supabase
      .from('work_items')
      .update(updateData)
      .eq('id', workItemId)
      .eq('owner_id', userId);
    
    if (error) {
      return { success: false, error: error.message };
    }
    
    // Log the manual update in work_item_acts
    await supabase
      .from('work_item_acts')
      .insert({
        owner_id: userId,
        work_item_id: workItemId,
        act_date: new Date().toISOString().split('T')[0],
        description: `Etapa actualizada manualmente a: ${suggestedStage}`,
        act_type: 'STAGE_UPDATE_MANUAL',
        source: 'MANUAL',
        source_reference: sourceActId,
        raw_data: {
          applied_stage: suggestedStage,
          applied_phase: suggestedCgpPhase,
          applied_by: userId,
        },
        hash_fingerprint: `manual_stage_${workItemId}_${Date.now()}`,
      });
    
    return { success: true };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Error desconocido' 
    };
  }
}
