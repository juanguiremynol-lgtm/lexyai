/**
 * Estados Ingestion Service
 * 
 * Specialized ingestion pipeline for Estados Excel imports.
 * Creates work_item_acts records and updates work_item phases/milestones.
 */

import { supabase } from "@/integrations/supabase/client";
import type { MatchedEstadosRow } from "@/lib/estados-matching";
import { detectMilestoneFromEstado } from "@/lib/estados-matching";

export type EstadoImportStatus = 'IMPORTED' | 'SKIPPED_DUPLICATE' | 'SKIPPED_UNLINKED' | 'FAILED';

export interface EstadoImportRowResult {
  radicado: string;
  work_item_id: string | null;
  status: EstadoImportStatus;
  reason?: string;
  act_id?: string;
  milestone_detected?: string;
  phase_updated?: boolean;
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
  row_results: EstadoImportRowResult[];
}

/**
 * Compute deterministic fingerprint for deduplication
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
 * Process a batch of matched estados rows
 * 
 * - Creates work_item_acts for each linked estado
 * - Detects milestones and updates CGP phase if needed
 * - Returns detailed results for logging
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

  for (const row of rows) {
    // Skip unlinked rows
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

    try {
      const workItemId = row.matched_work_item_id;
      const summary = buildEstadoSummary(row);
      const fingerprint = computeEstadoFingerprint(
        workItemId,
        row.fecha_ultima_actuacion,
        summary
      );

      // Check for duplicate
      const { data: existing } = await supabase
        .from("work_item_acts")
        .select("id")
        .eq("hash_fingerprint", fingerprint)
        .maybeSingle();

      if (existing) {
        results.push({
          radicado: row.radicado_norm,
          work_item_id: workItemId,
          status: 'SKIPPED_DUPLICATE',
          reason: 'Este estado ya fue importado anteriormente',
          act_id: existing.id,
        });
        skippedDuplicate++;
        continue;
      }

      // Detect milestone
      const milestoneInfo = detectMilestoneFromEstado(row.actuacion, row.anotacion);
      
      // Create work_item_act record
      const { data: act, error: actError } = await supabase
        .from("work_item_acts")
        .insert({
          owner_id: ownerId,
          work_item_id: workItemId,
          act_date: row.fecha_ultima_actuacion,
          act_date_raw: row.fecha_ultima_actuacion_raw,
          description: summary,
          act_type: milestoneInfo.milestone_type || 'ESTADO',
          source: 'ICARUS_ESTADOS',
          source_reference: runId,
          raw_data: {
            ...row.all_columns,
            despacho: row.despacho,
            juez_ponente: row.juez_ponente,
            demandantes: row.demandantes,
            demandados: row.demandados,
          },
          hash_fingerprint: fingerprint,
        })
        .select("id")
        .single();

      if (actError) {
        results.push({
          radicado: row.radicado_norm,
          work_item_id: workItemId,
          status: 'FAILED',
          reason: actError.message,
        });
        failed++;
        continue;
      }

      // Update work_item with latest action info
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      // Update last_action fields if this is the most recent
      if (row.fecha_ultima_actuacion) {
        updateData.last_action_date = row.fecha_ultima_actuacion;
        updateData.last_action_description = summary;
      }

      // Update authority info if available
      if (row.despacho && !row.matched_work_item?.authority_name) {
        updateData.authority_name = row.despacho;
      }

      // Update CGP phase if milestone triggers phase change
      let phaseUpdated = false;
      if (milestoneInfo.triggers_phase_change && milestoneInfo.new_cgp_phase) {
        const currentPhase = row.matched_work_item?.cgp_phase;
        if (currentPhase !== milestoneInfo.new_cgp_phase) {
          updateData.cgp_phase = milestoneInfo.new_cgp_phase;
          updateData.cgp_phase_source = 'ESTADO_IMPORT';
          
          // If AUTO_ADMISORIO detected, also set the date
          if (milestoneInfo.milestone_type === 'AUTO_ADMISORIO' && row.fecha_ultima_actuacion) {
            updateData.auto_admisorio_date = row.fecha_ultima_actuacion;
          }
          
          phaseUpdated = true;
          phaseUpdates++;
        }
      }

      // Update work_item
      await supabase
        .from("work_items")
        .update(updateData)
        .eq("id", workItemId);

      // Track milestone detection
      if (milestoneInfo.milestone_type) {
        milestonesDetected++;
      }

      results.push({
        radicado: row.radicado_norm,
        work_item_id: workItemId,
        status: 'IMPORTED',
        act_id: act.id,
        milestone_detected: milestoneInfo.milestone_type || undefined,
        phase_updated: phaseUpdated,
      });
      imported++;

    } catch (error) {
      results.push({
        radicado: row.radicado_norm,
        work_item_id: row.matched_work_item_id,
        status: 'FAILED',
        reason: error instanceof Error ? error.message : 'Error desconocido',
      });
      failed++;
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
    row_results: results,
  };
}

/**
 * Build a descriptive summary from estado row
 */
function buildEstadoSummary(row: MatchedEstadosRow): string {
  const parts: string[] = [];
  
  if (row.actuacion) {
    parts.push(row.actuacion);
  }
  
  if (row.anotacion && row.anotacion !== row.actuacion) {
    parts.push(row.anotacion);
  }
  
  return parts.join(' - ') || 'Estado electrónico';
}
