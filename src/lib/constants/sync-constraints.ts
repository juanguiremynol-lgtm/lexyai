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
