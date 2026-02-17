/**
 * Analytics Types — Shared types for the unified analytics wrapper
 */

export interface AnalyticsConfig {
  globalEnabled: boolean;
  posthogEnabled: boolean;
  sentryEnabled: boolean;
  sessionReplayEnabled: boolean;
  allowedProperties: string[];
  posthogHost: string;
  hashSecretConfigured: boolean;
  lastEventAt: string | null;
}

export interface OrgAnalyticsOverride {
  id: string;
  organization_id: string;
  analytics_enabled: boolean | null;
  session_replay_enabled: boolean | null;
  allowed_properties_override: string[] | null;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedAnalyticsConfig {
  enabled: boolean;
  sessionReplayEnabled: boolean;
  allowedProperties: string[];
  source: 'global' | 'org_override';
}

/** Safe event properties that can never contain PII */
export const DEFAULT_ALLOWED_PROPERTIES: string[] = [
  "event_name",
  "timestamp",
  "tenant_id_hash",
  "user_id_hash",
  "matter_id_hash",
  "route",
  "feature",
  "action",
  "count",
  "latency_ms",
  "duration_ms",
  "file_type_category",
  "size_bucket",
  "from_stage",
  "to_stage",
  "source_type",
  "rule_type",
  "days_offset",
  "export_type",
  "matter_type",
  "status_code",
  "workflow_type",
  "plan_name",
  "processes_count",
  "team_size",
  "chip_type",
  "data_kind",
  "entries_count",
  "export_type",
  "variant",
  "frame",
  "has_radicado",
  "source",
  "method",
  "radicado_length",
  "category",
  "outcome",
  "providers_with_data",
  "latency_bucket",
  "cta_type",
];

/** Properties that MUST NEVER be sent externally */
export const BLOCKED_PROPERTIES: string[] = [
  "party_name",
  "document_text",
  "case_content",
  "email",
  "phone",
  "cedula",
  "nit",
  "address",
  "search_query",
  "note_text",
  "file_name",
  "full_name",
  "first_name",
  "last_name",
  "password",
  "token",
  "secret",
  "api_key",
  "credential",
];
