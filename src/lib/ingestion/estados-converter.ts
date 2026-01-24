/**
 * Estados to NormalizedProcessSnapshot Converter
 * 
 * Converts parsed Estados Excel rows into normalized snapshots
 * for the unified ingestion pipeline.
 */

import type { EstadosExcelRow } from "@/lib/estados-excel-parser";
import type { NormalizedProcessSnapshot, EstadoNotification } from "./types";

/**
 * Convert a parsed Estados Excel row to a NormalizedProcessSnapshot
 */
export function estadosRowToSnapshot(
  row: EstadosExcelRow,
  runId: string
): NormalizedProcessSnapshot {
  // Build notification object
  const notification: EstadoNotification = {
    notification_date: row.fecha_ultima_actuacion,
    notification_date_raw: row.fecha_ultima_actuacion_raw,
    notification_type: row.actuacion || undefined,
    summary: buildNotificationSummary(row),
    triggers_term: detectTermTrigger(row),
    term_start_date: row.fecha_inicia_termino,
    anotacion: row.anotacion || undefined,
    source_columns: row.all_columns,
  };

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
    suggested_workflow_type: 'UNKNOWN',
    authority,
    parties: [],
    demandantes_text: row.demandantes || undefined,
    demandados_text: row.demandados || undefined,
    last_action: {
      action_date: row.fecha_ultima_actuacion,
      action_date_raw: row.fecha_ultima_actuacion_raw,
      description: row.actuacion || 'Estado',
      action_type: classifyAction(row.actuacion),
    },
    last_notification: notification,
    source: 'ICARUS_EXCEL_ESTADOS',
    source_run_id: runId,
    source_timestamp: new Date().toISOString(),
    source_payload: {
      ...row,
      matched_process_id: row.matched_process_id,
    },
    is_valid: row.radicado_norm.length === 23,
    validation_errors: row.radicado_norm.length !== 23 
      ? [`Radicado inválido: ${row.radicado_norm.length} dígitos`] 
      : [],
  };
}

/**
 * Build notification summary from row data
 */
function buildNotificationSummary(row: EstadosExcelRow): string {
  const parts: string[] = [];
  
  if (row.actuacion) {
    parts.push(row.actuacion);
  }
  
  if (row.anotacion) {
    parts.push(row.anotacion);
  }
  
  if (row.inicia_termino) {
    parts.push(`Inicia término: ${row.inicia_termino}`);
  }
  
  return parts.join(' | ') || 'Estado electrónico';
}

/**
 * Detect if this notification triggers a judicial term
 */
function detectTermTrigger(row: EstadosExcelRow): boolean {
  // If there's an explicit "inicia termino" field with value
  if (row.inicia_termino) {
    const normalized = row.inicia_termino.toLowerCase().trim();
    if (normalized === 'si' || normalized === 'sí' || normalized === 'yes' || normalized === '1') {
      return true;
    }
  }
  
  // If there's a "fecha inicia termino" that's valid
  if (row.fecha_inicia_termino) {
    return true;
  }
  
  // Check actuacion text for term-triggering keywords
  const actuacion = (row.actuacion || '').toLowerCase();
  const termTriggerKeywords = [
    'notifica',
    'traslado',
    'corre traslado',
    'se notifica',
    'fijación en lista',
    'fijacion en lista',
    'por estado',
    'por edicto',
    'personal',
    'aviso',
  ];
  
  return termTriggerKeywords.some(keyword => actuacion.includes(keyword));
}

/**
 * Classify action type from description
 */
function classifyAction(actuacion?: string): string {
  if (!actuacion) return 'OTRO';
  
  const lower = actuacion.toLowerCase();
  
  if (lower.includes('auto ')) return 'AUTO';
  if (lower.includes('sentencia')) return 'SENTENCIA';
  if (lower.includes('audiencia')) return 'AUDIENCIA';
  if (lower.includes('notifica')) return 'NOTIFICACION';
  if (lower.includes('traslado')) return 'TRASLADO';
  if (lower.includes('memorial')) return 'MEMORIAL';
  if (lower.includes('providencia')) return 'PROVIDENCIA';
  if (lower.includes('fijación') || lower.includes('fijacion')) return 'FIJACION_LISTA';
  
  return 'ACTUACION';
}

/**
 * Convert batch of Estados rows to snapshots
 */
export function convertEstadosBatch(
  rows: EstadosExcelRow[],
  runId: string
): NormalizedProcessSnapshot[] {
  return rows.map(row => estadosRowToSnapshot(row, runId));
}
