/**
 * Platform Verification Types & Helpers
 * 
 * Types and utilities for the Platform Verification tab
 */

// Snapshot response from platform_verification_snapshot RPC
export interface VerificationSnapshot {
  generated_at: string;
  platform_admin: boolean;
  schema: {
    email_outbox_columns_ok: boolean;
    email_outbox_columns_found: string[];
    email_outbox_indexes_ok: boolean;
    email_outbox_indexes_found: string[];
    job_runs_table_exists: boolean;
    job_runs_has_metadata: boolean;
    system_health_events_table_exists: boolean;
  };
  triggers: {
    audit_trigger_function_exists: boolean;
    organization_memberships_triggers_ok: boolean;
    subscriptions_trigger_ok: boolean;
    email_outbox_trigger_ok: boolean;
    triggers_found: string[];
  };
  rls: {
    audit_logs_rls_enabled: boolean;
    audit_logs_rls_forced: boolean;
    admin_notifications_rls_enabled: boolean;
    subscriptions_rls_enabled: boolean;
    organizations_rls_enabled: boolean;
  };
  activity_last_seen: {
    DB_MEMBERSHIP_INSERTED: string | null;
    DB_MEMBERSHIP_UPDATED: string | null;
    DB_MEMBERSHIP_DELETED: string | null;
    DB_SUBSCRIPTION_UPDATED: string | null;
    DB_EMAIL_STATUS_CHANGED: string | null;
  };
  jobs: {
    job_runs_table_exists: boolean;
    job_runs_has_metadata: boolean;
    purge_old_audit_logs_last_run: {
      status: string;
      finished_at: string;
      duration_ms: number;
      processed_count: number;
      preview: boolean;
    } | null;
    purge_old_audit_logs_last_error: {
      status: string;
      finished_at: string;
      error: string;
    } | null;
  };
}

// RLS Probe result
export interface ProbeResult {
  name: string;
  table: string;
  passed: boolean;
  rowCount: number | null;
  error: string | null;
  duration_ms: number;
}

// Combined verification state for export
export interface VerificationExport {
  exported_at: string;
  snapshot: VerificationSnapshot | null;
  snapshot_error: string | null;
  probes: ProbeResult[];
  probes_run_at: string | null;
}

// Check status type
export type CheckStatus = "PASS" | "FAIL" | "WARN";

// Get relative time string
export function getRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "never";
  
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

// Check if timestamp is within threshold (days)
export function isWithinDays(timestamp: string | null, days: number): boolean {
  if (!timestamp) return false;
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / 86400000;
  return diffDays <= days;
}

// Get activity status based on last-seen timestamp
export function getActivityStatus(timestamp: string | null, hasTrigger: boolean): CheckStatus {
  if (!hasTrigger) return "FAIL";
  if (!timestamp) return "WARN";
  if (isWithinDays(timestamp, 90)) return "PASS";
  return "WARN";
}

// Format duration in ms to human readable
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// Required email_outbox columns
export const REQUIRED_EMAIL_COLUMNS = [
  "provider_message_id",
  "last_event_type",
  "last_event_at",
  "failure_type",
  "failed_permanent"
];

// Activity action types tracked by DB triggers
export const TRIGGER_ACTIONS = [
  "DB_MEMBERSHIP_INSERTED",
  "DB_MEMBERSHIP_UPDATED", 
  "DB_MEMBERSHIP_DELETED",
  "DB_SUBSCRIPTION_UPDATED",
  "DB_EMAIL_STATUS_CHANGED"
] as const;

export type TriggerAction = typeof TRIGGER_ACTIONS[number];
