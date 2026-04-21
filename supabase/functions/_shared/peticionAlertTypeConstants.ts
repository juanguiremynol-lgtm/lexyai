/**
 * Canonical alert_type values for peticion-reminders.
 * Maps the legacy in-code names to the values accepted by the
 * downstream alert_instances / peticion_alerts CHECK constraints.
 *
 * Always import from this module instead of using raw string literals.
 */
export const PETICION_ALERT_TYPE = {
  DEADLINE_WARNING: 'PETICION_DEADLINE',
  DEADLINE_CRITICAL: 'PETICION_OVERDUE',
  PROROGATION_DEADLINE: 'PROROGATION_DEADLINE',
} as const;

export type PeticionAlertType =
  typeof PETICION_ALERT_TYPE[keyof typeof PETICION_ALERT_TYPE];