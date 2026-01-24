import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WorkflowType } from "@/lib/workflow-constants";
import { normalizeRadicadoInput, validateCgpRadicado } from "@/lib/radicado-utils";

export interface ProcessData {
  despacho?: string;
  ciudad?: string;
  departamento?: string;
  demandante?: string;
  demandado?: string;
  tipo_proceso?: string;
  clase_proceso?: string;
  fecha_radicacion?: string;
  ultima_actuacion?: string;
  fecha_ultima_actuacion?: string;
  sujetos_procesales?: Array<{ tipo: string; nombre: string }>;
  actuaciones?: Array<{
    fecha: string;
    actuacion: string;
    anotacion?: string;
  }>;
  total_actuaciones?: number;
}

export interface LookupResult {
  ok: boolean;
  found_in_source: boolean;
  source_used: string | null;
  new_events_count: number;
  cgp_phase: 'FILING' | 'PROCESS';
  classification_reason: string;
  process_data?: ProcessData;
  attempts?: Array<{
    source: string;
    success: boolean;
    latency_ms: number;
    error?: string;
    events_found?: number;
  }>;
  error?: string;
  code?: string;
}

export interface SyncResult extends LookupResult {
  work_item_id?: string;
  created: boolean;
  updated: boolean;
}

export type LookupStatus = 'idle' | 'loading' | 'success' | 'error' | 'not_found';

/**
 * Validation result for radicado input
 */
export interface RadicadoValidation {
  valid: boolean;
  normalized: string;
  error?: string;
}

export interface UseRadicadoLookupReturn {
  status: LookupStatus;
  result: LookupResult | null;
  error: string | null;
  lookup: (radicado: string, workflowType?: WorkflowType) => Promise<LookupResult | null>;
  sync: (radicado: string, options: SyncOptions) => Promise<SyncResult | null>;
  reset: () => void;
  validateRadicado: (radicado: string, workflowType?: WorkflowType) => RadicadoValidation;
}

export interface SyncOptions {
  workflow_type: WorkflowType;
  stage?: string;
  client_id?: string;
  create_if_missing?: boolean;
}

/**
 * Validate radicado based on workflow type
 * CGP requires 23 digits ending in 00 or 01
 * Other workflows require 23 digits
 */
function validateRadicadoForWorkflow(radicado: string, workflowType?: WorkflowType): RadicadoValidation {
  const normalized = normalizeRadicadoInput(radicado);
  
  if (normalized.length === 0) {
    return { valid: false, normalized: '', error: 'El radicado no contiene dígitos válidos' };
  }
  
  if (normalized.length !== 23) {
    return { 
      valid: false, 
      normalized, 
      error: `El radicado debe tener exactamente 23 dígitos numéricos (tiene ${normalized.length})` 
    };
  }
  
  // CGP-specific: must end with 00 or 01
  if (workflowType === 'CGP') {
    const cgpValidation = validateCgpRadicado(radicado);
    if (!cgpValidation.valid) {
      return { valid: false, normalized, error: cgpValidation.error };
    }
  }
  
  return { valid: true, normalized };
}

/**
 * Hook for looking up and syncing radicados via the unified sync-by-radicado edge function
 * 
 * This hook provides:
 * - LOOKUP mode: Preview data without creating/updating work items
 * - SYNC mode: Create or update work items with full normalization pipeline
 * - Automatic FILING/PROCESS classification based on Auto Admisorio detection
 */
/**
 * Hook for looking up and syncing radicados via the unified sync-by-radicado edge function
 * 
 * This hook provides:
 * - LOOKUP mode: Preview data without creating/updating work items
 * - SYNC mode: Create or update work items with full normalization pipeline
 * - Automatic FILING/PROCESS classification based on Auto Admisorio detection
 * - Proper validation including CGP-specific rules (ending 00/01)
 */
export function useRadicadoLookup(): UseRadicadoLookupReturn {
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  /**
   * Validate radicado for a specific workflow type
   */
  const validateRadicado = useCallback((radicado: string, workflowType?: WorkflowType): RadicadoValidation => {
    return validateRadicadoForWorkflow(radicado, workflowType);
  }, []);

  /**
   * LOOKUP mode: Fetch process data without creating/updating work items
   * Returns preview data including FILING/PROCESS classification
   * 
   * @param radicado - The radicado string (will be normalized)
   * @param workflowType - Optional workflow type for validation (CGP requires ending 00/01)
   */
  const lookup = useCallback(async (radicado: string, workflowType?: WorkflowType): Promise<LookupResult | null> => {
    // Validate with workflow-specific rules
    const validation = validateRadicadoForWorkflow(radicado, workflowType);
    
    if (!validation.valid) {
      setError(validation.error || 'Radicado inválido');
      setStatus('error');
      return null;
    }

    // Use the normalized string (preserves leading zeros)
    const cleanRadicado = validation.normalized;

    setStatus('loading');
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-by-radicado', {
        body: {
          radicado: cleanRadicado,
          mode: 'LOOKUP',
          workflow_type: workflowType,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Error en consulta');
      }

      if (!data.ok) {
        throw new Error(data.message || data.error || 'Error desconocido');
      }

      const lookupResult: LookupResult = {
        ok: data.ok,
        found_in_source: data.found_in_source,
        source_used: data.source_used,
        new_events_count: data.new_events_count,
        cgp_phase: data.cgp_phase || 'FILING',
        classification_reason: data.classification_reason || '',
        process_data: data.process_data,
        attempts: data.attempts,
      };

      setResult(lookupResult);
      
      if (data.found_in_source) {
        setStatus('success');
      } else {
        setStatus('not_found');
      }

      return lookupResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error de conexión';
      setError(errorMessage);
      setStatus('error');
      return null;
    }
  }, []);

  /**
   * SYNC mode: Create or update work item with full normalization pipeline
   */
  const sync = useCallback(async (
    radicado: string,
    options: SyncOptions
  ): Promise<SyncResult | null> => {
    // Validate with workflow-specific rules
    const validation = validateRadicadoForWorkflow(radicado, options.workflow_type);
    
    if (!validation.valid) {
      setError(validation.error || 'Radicado inválido');
      setStatus('error');
      return null;
    }

    // Use the normalized string (preserves leading zeros)
    const cleanRadicado = validation.normalized;

    setStatus('loading');
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('sync-by-radicado', {
        body: {
          radicado: cleanRadicado,
          mode: 'SYNC_AND_APPLY',
          workflow_type: options.workflow_type,
          stage: options.stage,
          client_id: options.client_id,
          create_if_missing: options.create_if_missing !== false,
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Error en sincronización');
      }

      if (!data.ok) {
        throw new Error(data.message || data.error || 'Error desconocido');
      }

      const syncResult: SyncResult = {
        ok: data.ok,
        work_item_id: data.work_item_id,
        created: data.created,
        updated: data.updated,
        found_in_source: data.found_in_source,
        source_used: data.source_used,
        new_events_count: data.new_events_count,
        cgp_phase: data.cgp_phase || 'FILING',
        classification_reason: data.classification_reason || '',
        process_data: data.process_data,
        attempts: data.attempts,
      };

      setResult(syncResult);
      setStatus('success');

      return syncResult;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error de conexión';
      setError(errorMessage);
      setStatus('error');
      return null;
    }
  }, []);

  return {
    status,
    result,
    error,
    lookup,
    sync,
    reset,
    validateRadicado,
  };
}
