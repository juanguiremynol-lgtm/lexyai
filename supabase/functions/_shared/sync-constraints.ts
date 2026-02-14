/**
 * sync-constraints.ts — Deno-compatible subset of src/lib/constants/sync-constraints.ts
 * for use in edge functions.
 *
 * Keep in sync with the frontend version.
 *
 * ENUM GOVERNANCE: When adding new observation kinds, you MUST:
 * 1. Add a migration: ALTER TYPE observation_kind ADD VALUE 'NEW_KIND';
 * 2. Add the value to ALLOWED_OBSERVATION_KINDS here AND in src/lib/constants/sync-constraints.ts
 * 3. Update docs/EGRESS_POLICY_MATRIX.md if security-related
 * 4. Run egress-proxy-validation on staging
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

export const ALLOWED_DATE_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type DateConfidence = typeof ALLOWED_DATE_CONFIDENCES[number];

export const DATE_SOURCE_TO_CONFIDENCE: Record<DateSource, DateConfidence> = {
  api_explicit: 'high',
  api_metadata: 'high',
  parsed_filename: 'medium',
  parsed_annotation: 'medium',
  parsed_title: 'low',
  inferred_sync: 'low',
  manual: 'high',
};

export function isValidDateSource(value: string): value is DateSource {
  return (ALLOWED_DATE_SOURCES as readonly string[]).includes(value);
}

export function sanitizeDateSource(value: string | null | undefined): DateSource {
  if (value && isValidDateSource(value)) return value;
  if (value === 'inferred') return 'inferred_sync';
  if (value === 'api') return 'api_explicit';
  return 'inferred_sync';
}

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
] as const;

export type ObservationKind = typeof ALLOWED_OBSERVATION_KINDS[number];

/** Observation kinds restricted to platform admins only */
export const SECURITY_OBSERVATION_KINDS: readonly ObservationKind[] = [
  'EGRESS_VIOLATION',
  'SECURITY_ALERT',
] as const;

// ============= Observation Severity (DB ENUM: observation_severity) =============
export const ALLOWED_OBSERVATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type ObservationSeverity = typeof ALLOWED_OBSERVATION_SEVERITIES[number];

// ============= Validation Helpers =============

export function isValidObservationKind(value: string): value is ObservationKind {
  return (ALLOWED_OBSERVATION_KINDS as readonly string[]).includes(value);
}

export function isValidObservationSeverity(value: string): value is ObservationSeverity {
  return (ALLOWED_OBSERVATION_SEVERITIES as readonly string[]).includes(value);
}

export function validateObservationKind(value: string): ObservationKind {
  if (isValidObservationKind(value)) return value;
  throw new Error(`Invalid observation kind: "${value}". Allowed: ${ALLOWED_OBSERVATION_KINDS.join(', ')}`);
}

export function validateObservationSeverity(value: string): ObservationSeverity {
  if (isValidObservationSeverity(value)) return value;
  throw new Error(`Invalid observation severity: "${value}". Allowed: ${ALLOWED_OBSERVATION_SEVERITIES.join(', ')}`);
}

// ============= Security Observation Payload Schema =============
// Structural enforcement: only these keys are accepted for security observations.
// This prevents arbitrary data from leaking into security telemetry.

export const SECURITY_OBSERVATION_ALLOWED_PAYLOAD_KEYS = new Set([
  // Egress violation fields
  'type', 'caller', 'tenant_hash', 'purpose', 'target_domain',
  'rule_triggered', 'payload_size_bucket', 'request_id', 'timestamp',
  // Security alert fields
  'rule_id', 'description', 'org_id', 'event_count', 'threshold',
  'window_minutes', 'detected_at', 'audit_log_id', 'new_role',
  'observation_ids', 'violation_count', 'actions', 'audit_log_ids',
  'table', 'access_count', 'correlation_id', 'size_bucket',
]);

/**
 * Validate and sanitize a security observation payload.
 * Strips any keys not in the whitelist. Returns a clean copy.
 */
export function sanitizeSecurityPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SECURITY_OBSERVATION_ALLOWED_PAYLOAD_KEYS.has(key)) {
      // Reject large string values (>500 chars) to prevent data leaks
      if (typeof value === 'string' && value.length > 500) {
        clean[key] = value.substring(0, 200) + '…[truncated]';
      } else {
        clean[key] = value;
      }
    }
    // Silently drop unknown keys — logged in caller
  }
  return clean;
}
