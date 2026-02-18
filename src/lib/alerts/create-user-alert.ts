/**
 * Unified User Alert Creator
 * 
 * Inserts into the `notifications` table (USER audience) with dedup.
 * Respects user alert_preferences before inserting.
 * 
 * NOTE: DB triggers on work_item_acts, work_item_publicaciones, 
 * work_item_stage_audit, and work_item_tasks handle server-side alerts
 * automatically. This utility is for client-side alert generation
 * (e.g., petición created, hearing created, milestones).
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
 * Create a user-facing notification in the unified `notifications` table.
 * Checks alert_preferences to see if the user has disabled this type.
 * Deduplicates by dedupe_key to prevent duplicates from retries.
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
    // 1. Check user preferences (skip if explicitly disabled)
    const { data: prefs } = await supabase
      .from('alert_preferences')
      .select('preferences')
      .eq('user_id', userId)
      .maybeSingle();

    if (prefs?.preferences) {
      const typePref = (prefs.preferences as Record<string, { enabled?: boolean }>)[alertType];
      if (typePref && typePref.enabled === false) {
        return { success: true, isDuplicate: false };
      }
    }

    // 2. Build dedupe key
    const effectiveDedupeKey = dedupeKey || `${alertType}_${workItemId || userId}_${new Date().toISOString().split('T')[0]}`;

    // 3. Check for existing notification with same dedupe key
    const { data: existing } = await supabase
      .from('notifications' as any)
      .select('id')
      .eq('dedupe_key', effectiveDedupeKey)
      .maybeSingle();

    if (existing) {
      return { success: true, isDuplicate: true };
    }

    // 4. Insert notification
    const { error: insertError } = await (supabase.from('notifications') as any)
      .insert({
        audience_scope: 'USER',
        user_id: userId,
        category: 'WORK_ITEM_ALERTS',
        type: alertType,
        title,
        body: body || null,
        severity,
        metadata: { ...metadata, alert_type_label: ALERT_TYPE_LABELS[alertType] },
        dedupe_key: effectiveDedupeKey,
        deep_link: deepLink || (workItemId ? `/app/work-items/${workItemId}` : null),
        work_item_id: workItemId || null,
      });

    if (insertError) {
      // Unique constraint = race condition duplicate
      if (insertError.code === '23505') {
        return { success: true, isDuplicate: true };
      }
      return { success: false, error: insertError.message };
    }

    return { success: true, isDuplicate: false };
  } catch (err) {
    console.error('[createUserAlert] error:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
