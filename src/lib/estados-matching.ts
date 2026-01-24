/**
 * Estados Matching Utilities
 * 
 * Provides deterministic matching of estados rows to work_items using radicado.
 * CRITICAL: Radicado is always treated as a 23-digit string.
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeRadicadoInput } from "./radicado-utils";
import type { EstadosExcelRow } from "./estados-excel-parser";

export interface MatchedEstadosRow extends EstadosExcelRow {
  matched_work_item_id: string | null;
  matched_work_item: {
    id: string;
    radicado: string;
    workflow_type: string;
    authority_name: string | null;
    demandantes: string | null;
    client_id: string | null;
    cgp_phase: string | null;
  } | null;
  match_status: 'LINKED' | 'UNLINKED';
}

export interface EstadosMatchResult {
  rows: MatchedEstadosRow[];
  linked_count: number;
  unlinked_count: number;
  total_count: number;
}

/**
 * Match Estados Excel rows to existing work_items using normalized radicado
 * 
 * This is the PRIMARY matching function - it queries work_items (canonical table).
 */
export async function matchEstadosToWorkItems(
  rows: EstadosExcelRow[]
): Promise<EstadosMatchResult> {
  // Get all unique normalized radicados from the Excel
  const radicados = [...new Set(rows.map(r => normalizeRadicadoInput(r.radicado_raw)))];
  
  // Query work_items for matching radicados (owner scoped via RLS)
  const { data: workItems, error } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, authority_name, demandantes, client_id, cgp_phase")
    .in("radicado", radicados)
    .eq("status", "ACTIVE");

  if (error) {
    console.error("Error matching estados to work_items:", error);
    // Return all as unlinked if query fails
    return {
      rows: rows.map(row => ({
        ...row,
        matched_work_item_id: null,
        matched_work_item: null,
        match_status: 'UNLINKED' as const,
      })),
      linked_count: 0,
      unlinked_count: rows.length,
      total_count: rows.length,
    };
  }

  // Build a map for O(1) lookup by normalized radicado
  const workItemMap = new Map<string, typeof workItems[number]>();
  workItems?.forEach(wi => {
    if (wi.radicado) {
      workItemMap.set(normalizeRadicadoInput(wi.radicado), wi);
    }
  });

  // Match each row
  const matchedRows: MatchedEstadosRow[] = rows.map(row => {
    const normalizedRadicado = normalizeRadicadoInput(row.radicado_raw);
    const workItem = workItemMap.get(normalizedRadicado);

    if (workItem) {
      return {
        ...row,
        radicado_norm: normalizedRadicado, // Ensure normalized
        matched_work_item_id: workItem.id,
        matched_work_item: {
          id: workItem.id,
          radicado: workItem.radicado || '',
          workflow_type: workItem.workflow_type,
          authority_name: workItem.authority_name,
          demandantes: workItem.demandantes,
          client_id: workItem.client_id,
          cgp_phase: workItem.cgp_phase,
        },
        match_status: 'LINKED' as const,
      };
    }

    return {
      ...row,
      radicado_norm: normalizedRadicado,
      matched_work_item_id: null,
      matched_work_item: null,
      match_status: 'UNLINKED' as const,
    };
  });

  const linkedCount = matchedRows.filter(r => r.match_status === 'LINKED').length;

  return {
    rows: matchedRows,
    linked_count: linkedCount,
    unlinked_count: matchedRows.length - linkedCount,
    total_count: matchedRows.length,
  };
}

/**
 * Detect milestones from estado content for CGP phase updates
 * 
 * Returns detected milestone type if found
 */
export function detectMilestoneFromEstado(
  actuacion: string | undefined,
  anotacion: string | undefined
): { 
  milestone_type: string | null;
  triggers_phase_change: boolean;
  new_cgp_phase: 'FILING' | 'PROCESS' | null;
} {
  const text = `${actuacion || ''} ${anotacion || ''}`.toLowerCase();

  // AUTO ADMISORIO detection - most critical milestone
  const autoAdmisorioPatterns = [
    'auto admisorio',
    'auto que admite',
    'admite demanda',
    'admite la demanda',
    'admítese demanda',
    'admitese demanda',
    'auto admite',
  ];
  
  if (autoAdmisorioPatterns.some(p => text.includes(p))) {
    return {
      milestone_type: 'AUTO_ADMISORIO',
      triggers_phase_change: true,
      new_cgp_phase: 'PROCESS',
    };
  }

  // INADMISION detection
  const inadmisionPatterns = [
    'auto inadmisorio',
    'inadmite demanda',
    'inadmite la demanda',
    'auto que inadmite',
  ];
  
  if (inadmisionPatterns.some(p => text.includes(p))) {
    return {
      milestone_type: 'INADMISION',
      triggers_phase_change: false,
      new_cgp_phase: null,
    };
  }

  // REQUERIMIENTO detection
  const requerimientoPatterns = [
    'requerimiento',
    'requiere a la parte',
    'se requiere',
    'auto requiere',
  ];
  
  if (requerimientoPatterns.some(p => text.includes(p))) {
    return {
      milestone_type: 'REQUERIMIENTO',
      triggers_phase_change: false,
      new_cgp_phase: null,
    };
  }

  // AUDIENCIA scheduling detection
  const audienciaPatterns = [
    'fija fecha para audiencia',
    'se señala audiencia',
    'audiencia programada',
    'celebración de audiencia',
    'fecha de audiencia',
  ];
  
  if (audienciaPatterns.some(p => text.includes(p))) {
    return {
      milestone_type: 'AUDIENCIA_PROGRAMADA',
      triggers_phase_change: false,
      new_cgp_phase: null,
    };
  }

  // SENTENCIA detection
  const sentenciaPatterns = [
    'sentencia',
    'fallo',
    'se profiere sentencia',
    'decisión de fondo',
  ];
  
  if (sentenciaPatterns.some(p => text.includes(p))) {
    return {
      milestone_type: 'SENTENCIA',
      triggers_phase_change: false,
      new_cgp_phase: null,
    };
  }

  return {
    milestone_type: null,
    triggers_phase_change: false,
    new_cgp_phase: null,
  };
}
