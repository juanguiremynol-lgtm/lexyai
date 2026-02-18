/**
 * Unified User Alert Creator
 * 
 * Client-side fallback that calls the same server-side `insert_notification()`
 * function used by all DB triggers, ensuring a single insertion contract.
 * 
 * NOTE: DB triggers on work_items, work_item_acts, work_item_publicaciones, 
 * work_item_stage_audit, work_item_tasks, and hearings handle server-side
 * alerts automatically. This utility is for edge cases only (e.g., cron-based
 * alerts like TAREA_VENCIDA, AUDIENCIA_PROXIMA).
 */

import { supabase } from '@/integrations/supabase/client';

export type UserAlertType =
  | 'ACTUACION_NUEVA'
  | 'ESTADO_NUEVO'
  | 'STAGE_CHANGE'
  | 'TAREA_CREADA'
  | 'TAREA_VENCIDA'
  | 'AUDIENCIA_PROXIMA'
  | 'AUDIENCIA_CREADA'
  | 'TERMINO_CRITICO'
  | 'TERMINO_VENCIDO'
  | 'PETICION_CREADA'
  | 'HITO_ALCANZADO';

/** Spanish labels for notification type badges */
export const ALERT_TYPE_LABELS: Record<UserAlertType, string> = {
  ACTUACION_NUEVA: 'Nueva Actuación',
  ESTADO_NUEVO: 'Nuevo Estado',
  STAGE_CHANGE: 'Cambio de Etapa',
  TAREA_CREADA: 'Tarea Creada',
  TAREA_VENCIDA: 'Tarea Vencida',
  AUDIENCIA_PROXIMA: 'Audiencia Próxima',
  AUDIENCIA_CREADA: 'Audiencia Creada',
  TERMINO_CRITICO: 'Término Crítico',
  TERMINO_VENCIDO: 'Término Vencido',
  PETICION_CREADA: 'Petición Creada',
  HITO_ALCANZADO: 'Hito Alcanzado',
};

export interface CreateUserAlertParams {
  userId: string;
  workItemId?: string;
  alertType: UserAlertType;
  severity?: 'info' | 'warning' | 'critical';
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  deepLink?: string;
  /** Used for dedup — if not provided, one is auto-generated */
  dedupeKey?: string;
}

/**
 * Create a user-facing notification via RPC.
 * Uses the same `insert_notification()` function as all DB triggers,
 * ensuring a single contract for dedup, preferences, and insertion.
 */
export async function createUserAlert(params: CreateUserAlertParams): Promise<{
  success: boolean;
  isDuplicate?: boolean;
  error?: string;
}> {
  const {
    userId,
    workItemId,
    alertType,
    severity = 'info',
    title,
    body,
    metadata = {},
    deepLink,
    dedupeKey,
  } = params;

  try {
    const effectiveDedupeKey = dedupeKey || `${alertType}_${workItemId || userId}_${new Date().toISOString().split('T')[0]}`;

    const { error: rpcError } = await supabase.rpc('rpc_insert_notification' as any, {
      p_audience_scope: 'USER',
      p_user_id: userId,
      p_category: 'WORK_ITEM_ALERTS',
      p_type: alertType,
      p_title: title,
      p_body: body || null,
      p_severity: severity,
      p_metadata: { ...metadata, alert_type_label: ALERT_TYPE_LABELS[alertType] },
      p_dedupe_key: effectiveDedupeKey,
      p_deep_link: deepLink || (workItemId ? `/app/work-items/${workItemId}` : null),
      p_work_item_id: workItemId || null,
    });

    if (rpcError) {
      // Unique constraint = dedupe hit
      if (rpcError.code === '23505') {
        return { success: true, isDuplicate: true };
      }
      return { success: false, error: rpcError.message };
    }

    return { success: true, isDuplicate: false };
  } catch (err) {
    console.error('[createUserAlert] error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
