/**
 * Canonical `notifications.type` values emitted by DB triggers
 * (insert_notification + work_items / work_item_acts / work_item_publicaciones /
 * work_item_stage_audit / work_item_tasks / hearings).
 *
 * This is a TS-only constants extraction — DB trigger bodies are the source of
 * truth and are NOT modified by introducing this module. Future TS consumers
 * (edge functions, scripts, client utilities) MUST import from here instead of
 * using raw string literals.
 */
export const NOTIFICATION_TYPE = {
  ACTUACION_NUEVA: 'ACTUACION_NUEVA',
  ESTADO_NUEVO: 'ESTADO_NUEVO',
  AUDIENCIA_CREADA: 'AUDIENCIA_CREADA',
  TAREA_CREADA: 'TAREA_CREADA',
  STAGE_CHANGE: 'STAGE_CHANGE',
  HITO_ALCANZADO: 'HITO_ALCANZADO',
  PETICION_CREADA: 'PETICION_CREADA',
} as const;

export type NotificationType =
  typeof NOTIFICATION_TYPE[keyof typeof NOTIFICATION_TYPE];

export const NOTIFICATION_TYPES: readonly NotificationType[] = Object.freeze(
  Object.values(NOTIFICATION_TYPE),
);

export function isKnownNotificationType(
  value: string | null | undefined,
): value is NotificationType {
  return !!value && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}