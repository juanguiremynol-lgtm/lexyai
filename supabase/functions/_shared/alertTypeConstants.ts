/**
 * alertTypeConstants.ts — Single source of truth for judicial alert type strings.
 *
 * CRITICAL: These MUST match the values used in PostgreSQL triggers
 * (set_actuacion_notifiable_and_alert, set_publicacion_notifiable_and_alert).
 * If a trigger uses a different string, emails will silently fail.
 *
 * Before renaming any value here, search ALL migrations + triggers for the old value.
 */

// ── Canonical alert type strings (match DB triggers exactly) ──
export const ALERT_TYPE_ACTUACION_NUEVA = "ACTUACION_NUEVA" as const;
export const ALERT_TYPE_ACTUACION_MODIFIED = "ACTUACION_MODIFIED" as const;
export const ALERT_TYPE_ESTADO_NUEVO = "ESTADO_NUEVO" as const;
export const ALERT_TYPE_ESTADO_MODIFIED = "ESTADO_MODIFIED" as const;

/** All judicial movement alert types used for email dispatch */
export const JUDICIAL_ALERT_TYPES = [
  ALERT_TYPE_ACTUACION_NUEVA,
  ALERT_TYPE_ACTUACION_MODIFIED,
  ALERT_TYPE_ESTADO_NUEVO,
  ALERT_TYPE_ESTADO_MODIFIED,
] as const;

export type JudicialAlertType = typeof JUDICIAL_ALERT_TYPES[number];

/** Human-readable labels (Spanish UI) */
export const JUDICIAL_TYPE_LABELS: Record<JudicialAlertType, string> = {
  [ALERT_TYPE_ACTUACION_NUEVA]: "Nueva actuación",
  [ALERT_TYPE_ACTUACION_MODIFIED]: "Actuación modificada",
  [ALERT_TYPE_ESTADO_NUEVO]: "Nuevo estado",
  [ALERT_TYPE_ESTADO_MODIFIED]: "Estado modificado",
};

/** Emoji icons per type */
export const JUDICIAL_TYPE_ICONS: Record<JudicialAlertType, string> = {
  [ALERT_TYPE_ACTUACION_NUEVA]: "🆕",
  [ALERT_TYPE_ACTUACION_MODIFIED]: "✏️",
  [ALERT_TYPE_ESTADO_NUEVO]: "📋",
  [ALERT_TYPE_ESTADO_MODIFIED]: "✏️",
};

// ── Prefix helpers (used for grouping in HTML) ──
export const ACTUACION_PREFIX = "ACTUACION" as const;
export const ESTADO_PREFIX = "ESTADO" as const;

export function isActuacionType(alertType: string | null | undefined): boolean {
  return !!alertType && alertType.startsWith(ACTUACION_PREFIX);
}

export function isEstadoType(alertType: string | null | undefined): boolean {
  return !!alertType && alertType.startsWith(ESTADO_PREFIX);
}

/**
 * Validates that an alert_type string is one of the known judicial types.
 * Returns false for unknown types (indicates trigger/code drift).
 */
export function isKnownJudicialType(alertType: string): alertType is JudicialAlertType {
  return (JUDICIAL_ALERT_TYPES as readonly string[]).includes(alertType);
}

// ── Required payload fields per type (for completeness validation) ──
export const REQUIRED_PAYLOAD_FIELDS: Record<string, string[]> = {
  [ACTUACION_PREFIX]: ["description", "source"],
  [ESTADO_PREFIX]: ["description", "source"],
};

export const RECOMMENDED_PAYLOAD_FIELDS: Record<string, string[]> = {
  [ACTUACION_PREFIX]: ["act_id", "act_date", "annotation", "despacho"],
  [ESTADO_PREFIX]: ["pub_id", "fecha_fijacion", "observacion"],
};

/**
 * Validates payload completeness and returns warnings for missing fields.
 * Does NOT block dispatch — only logs warnings for observability.
 */
export function validateAlertPayload(
  alertType: string,
  payload: Record<string, unknown> | null,
): { warnings: string[] } {
  const warnings: string[] = [];
  if (!payload) {
    warnings.push(`Alert type ${alertType} has null payload`);
    return { warnings };
  }

  const prefix = isActuacionType(alertType) ? ACTUACION_PREFIX : isEstadoType(alertType) ? ESTADO_PREFIX : null;
  if (!prefix) return { warnings };

  for (const field of REQUIRED_PAYLOAD_FIELDS[prefix] || []) {
    if (!payload[field]) {
      warnings.push(`Missing required field '${field}' in ${alertType} payload`);
    }
  }

  for (const field of RECOMMENDED_PAYLOAD_FIELDS[prefix] || []) {
    if (!payload[field]) {
      warnings.push(`Missing recommended field '${field}' in ${alertType} payload (will show "—" in email)`);
    }
  }

  return { warnings };
}
