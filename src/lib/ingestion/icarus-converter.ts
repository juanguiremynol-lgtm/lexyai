/**
 * ICARUS Process Excel to NormalizedProcessSnapshot Converter
 * 
 * Converts parsed ICARUS Excel rows into normalized snapshots
 * for the unified ingestion pipeline.
 */

import type { IcarusExcelRow } from "@/lib/icarus-excel-parser";
import type { NormalizedProcessSnapshot, SuggestedWorkflowType } from "./types";

/**
 * Convert a parsed ICARUS Excel row to a NormalizedProcessSnapshot
 */
export function icarusRowToSnapshot(
  row: IcarusExcelRow,
  runId: string
): NormalizedProcessSnapshot {
  // Detect workflow type from despacho
  const suggestedType = detectWorkflowTypeFromDespacho(row.despacho);

  // Build authority info
  const authority = row.despacho ? {
    despacho_name: row.despacho,
    city: undefined,
    department: row.distrito || undefined,
    judge_name: row.juez_ponente || undefined,
  } : null;

  return {
    radicado: row.radicado_norm,
    radicado_raw: row.radicado_raw,
    suggested_workflow_type: suggestedType,
    authority,
    parties: [],
    demandantes_text: row.demandantes || undefined,
    demandados_text: row.demandados || undefined,
    last_action: row.last_action_date_raw ? {
      action_date: row.last_action_date_iso,
      action_date_raw: row.last_action_date_raw,
      description: 'Última actuación',
      action_type: 'ACTUACION',
    } : null,
    last_notification: null, // Process exports don't have estado data
    source: 'ICARUS_EXCEL_PROCESS',
    source_run_id: runId,
    source_timestamp: new Date().toISOString(),
    source_payload: {
      radicado_raw: row.radicado_raw,
      despacho: row.despacho,
      distrito: row.distrito,
      juez_ponente: row.juez_ponente,
      demandantes: row.demandantes,
      demandados: row.demandados,
      last_action_date_raw: row.last_action_date_raw,
    },
    is_valid: row.is_valid,
    validation_errors: row.validation_error ? [row.validation_error] : [],
  };
}

/**
 * Detect workflow type from despacho name
 */
function detectWorkflowTypeFromDespacho(despacho: string): SuggestedWorkflowType {
  if (!despacho) return 'UNKNOWN';
  
  const lower = despacho.toLowerCase();
  
  // Tutela detection
  if (
    lower.includes('tutela') ||
    lower.includes('habeas corpus') ||
    lower.includes('constitucional')
  ) {
    return 'TUTELA';
  }
  
  // Administrative/CPACA detection
  if (
    lower.includes('contencioso administrativo') ||
    lower.includes('tribunal administrativo') ||
    lower.includes('consejo de estado')
  ) {
    return 'CPACA';
  }
  
  // Civil courts → CGP
  if (
    lower.includes('civil') ||
    lower.includes('familia') ||
    lower.includes('laboral') ||
    lower.includes('comercial') ||
    lower.includes('municipal') ||
    lower.includes('circuito')
  ) {
    return 'CGP';
  }
  
  return 'UNKNOWN';
}

/**
 * Convert batch of ICARUS rows to snapshots
 */
export function convertIcarusBatch(
  rows: IcarusExcelRow[],
  runId: string
): NormalizedProcessSnapshot[] {
  return rows.map(row => icarusRowToSnapshot(row, runId));
}
