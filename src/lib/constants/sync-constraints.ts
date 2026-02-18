/**
 * Sync Constraints — Single source of truth for DB-constrained enum values
 * 
 * These constants must stay aligned with the CHECK constraints on:
 * - work_item_acts (check_date_source, check_date_confidence)
 * - work_item_publicaciones (check_pub_date_source, check_pub_date_confidence)
 * - alert_instances (alert_instances_status_check, alert_instances_severity_check)
 * 
 * Edge Functions and frontend code should import from here instead of
 * hardcoding string literals, eliminating enum/constraint drift bugs.
 */

// ============= Date Source =============
export const ALLOWED_DATE_SOURCES = [
  'api_explicit',
  'parsed_filename',
  'parsed_annotation',
  'parsed_title',
  'api_metadata',
  'inferred_sync',
  'manual',
] as const;

export type DateSource = typeof ALLOWED_DATE_SOURCES[number];

// ============= Date Confidence =============
export const ALLOWED_DATE_CONFIDENCES = [
  'high',
  'medium',
  'low',
] as const;

export type DateConfidence = typeof ALLOWED_DATE_CONFIDENCES[number];

/** Map date_source → date_confidence for automatic mapping */
export const DATE_SOURCE_TO_CONFIDENCE: Record<DateSource, DateConfidence> = {
  api_explicit: 'high',
  api_metadata: 'high',
  parsed_filename: 'medium',
  parsed_annotation: 'medium',
  parsed_title: 'low',
  inferred_sync: 'low',
  manual: 'high',
};

// ============= Alert Severity =============
export const ALLOWED_ALERT_SEVERITIES = [
  'INFO',
  'WARNING',
  'CRITICAL',
] as const;

export type AlertSeverity = typeof ALLOWED_ALERT_SEVERITIES[number];

// ============= Observation Kind (DB ENUM: observation_kind) =============
export const ALLOWED_OBSERVATION_KINDS = [
  'GATE_FAILURE',
  'PROVIDER_DEGRADED',
  'CRON_PARTIAL',
  'CRON_FAILED',
  'GHOST_ITEMS',
  'CLASSIFICATION_ANOMALY',
  'STUCK_CONVERGENCE',
  'SYNC_TIMEOUT',
  'DATA_QUALITY',
  'HEARTBEAT_OBSERVED',
  'HEARTBEAT_SKIPPED',
  'REMEDIATION_ATTEMPTED',
  'PROVIDER_RECOVERED',
  'EGRESS_VIOLATION',
  'SECURITY_ALERT',
  'PROVIDER_DEGRADED_WIRING',
  'EXT_FAILURES',
  'GHOST_ITEMS_WIRING',
  'ALERT_CREATED',
  'ADMIN_NOTIFICATION',
  'DIAGNOSTIC_ESCALATION',
] as const;

export type ObservationKind = typeof ALLOWED_OBSERVATION_KINDS[number];

/** Observation kinds restricted to platform admins only */
export const SECURITY_OBSERVATION_KINDS: readonly ObservationKind[] = [
  'EGRESS_VIOLATION',
  'SECURITY_ALERT',
] as const;

// ============= Observation Severity (DB ENUM: observation_severity) =============
export const ALLOWED_OBSERVATION_SEVERITIES = ALLOWED_ALERT_SEVERITIES;
export type ObservationSeverity = AlertSeverity;

// ============= Validation Helpers (Observations) =============

export function isValidObservationKind(value: string): value is ObservationKind {
  return (ALLOWED_OBSERVATION_KINDS as readonly string[]).includes(value);
}

export function isValidObservationSeverity(value: string): value is ObservationSeverity {
  return (ALLOWED_OBSERVATION_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Sanitize an observation kind, returning the value if valid or throwing
 * to prevent silent constraint failures.
 */
export function validateObservationKind(value: string): ObservationKind {
  if (isValidObservationKind(value)) return value;
  throw new Error(`Invalid observation kind: "${value}". Allowed: ${ALLOWED_OBSERVATION_KINDS.join(', ')}`);
}

// ============= Alert Status =============
export const ALLOWED_ALERT_STATUSES = [
  'PENDING',
  'SENT',
  'ACKNOWLEDGED',
  'RESOLVED',
  'CANCELLED',
  'DISMISSED',
] as const;

export type AlertStatus = typeof ALLOWED_ALERT_STATUSES[number];

/** Status to use when creating new alerts (required by DB constraint) */
export const ALERT_INITIAL_STATUS: AlertStatus = 'PENDING';

// ============= Sync Error Classes =============
/** Retry policy by HTTP status class */
export const SYNC_ERROR_POLICY = {
  /** Never retry; escalate as credentials misconfigured */
  AUTH_FAILURE: [401, 403],
  /** No retry; mark as not found */
  NOT_FOUND: [404],
  /** Retry with exponential backoff + jitter */
  RATE_LIMITED: [429],
  /** Retry limited times; then circuit-break */
  SERVER_ERROR_MIN: 500,
  SERVER_ERROR_MAX: 599,
} as const;

export function getRetryPolicy(httpStatus: number): 'never' | 'not_found' | 'backoff' | 'limited_retry' | 'proceed' {
  if (SYNC_ERROR_POLICY.AUTH_FAILURE.includes(httpStatus as any)) return 'never';
  if (SYNC_ERROR_POLICY.NOT_FOUND.includes(httpStatus as any)) return 'not_found';
  if (httpStatus === 429) return 'backoff';
  if (httpStatus >= SYNC_ERROR_POLICY.SERVER_ERROR_MIN && httpStatus <= SYNC_ERROR_POLICY.SERVER_ERROR_MAX) return 'limited_retry';
  return 'proceed';
}

// ============= Validation Helpers =============

export function isValidDateSource(value: string): value is DateSource {
  return (ALLOWED_DATE_SOURCES as readonly string[]).includes(value);
}

export function isValidAlertSeverity(value: string): value is AlertSeverity {
  return (ALLOWED_ALERT_SEVERITIES as readonly string[]).includes(value);
}

export function isValidAlertStatus(value: string): value is AlertStatus {
  return (ALLOWED_ALERT_STATUSES as readonly string[]).includes(value);
}

/**
 * Sanitize a date_source value to a valid DB value.
 * Returns the value if valid, or 'inferred_sync' as safe fallback.
 */
export function sanitizeDateSource(value: string | null | undefined): DateSource {
  if (value && isValidDateSource(value)) return value;
  // Common drift corrections
  if (value === 'inferred') return 'inferred_sync';
  if (value === 'api') return 'api_explicit';
  return 'inferred_sync';
}
