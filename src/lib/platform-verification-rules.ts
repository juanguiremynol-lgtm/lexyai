/**
 * Platform Verification Rules
 * 
 * Deterministic PASS/FAIL/WARN evaluation logic for production acceptance tests
 */

import type { VerificationSnapshot, ProbeResult } from "./platform-verification";

export type VerificationLevel = "PASS" | "WARN" | "FAIL";

export type VerificationCheck = {
  id: string;
  category: "Schema" | "Triggers" | "RLS" | "Activity" | "Jobs" | "Probes";
  label: string;
  level: VerificationLevel;
  details?: string;
  evidence?: Record<string, unknown>;
};

export interface AcceptanceReport {
  generated_at: string;
  overall: VerificationLevel;
  counts: { pass: number; warn: number; fail: number };
  checks: VerificationCheck[];
}

// Required index names for email_outbox
const REQUIRED_EMAIL_INDEXES = [
  "idx_email_outbox_org_status_next",
  "idx_email_outbox_provider_message_id"
];

// Freshness thresholds in days
const FRESHNESS_THRESHOLD_DAYS = 30;
const JOB_STALE_THRESHOLD_DAYS = 14;
const JOB_ERROR_THRESHOLD_DAYS = 7;

/**
 * Check if a timestamp is within a threshold (in days)
 */
function isWithinDays(timestamp: string | null, days: number): boolean {
  if (!timestamp) return false;
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / 86400000;
  return diffDays <= days;
}

/**
 * Get freshness status for a timestamp
 */
function getFreshnessLevel(timestamp: string | null): VerificationLevel {
  if (!timestamp) return "WARN";
  if (isWithinDays(timestamp, FRESHNESS_THRESHOLD_DAYS)) return "PASS";
  return "WARN";
}

/**
 * Check if an index exists by name pattern
 */
function hasIndex(indexes: string[], pattern: string): boolean {
  return indexes.some(idx => idx.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * Evaluate all verification checks from snapshot
 */
export function evaluateSnapshot(snapshot: VerificationSnapshot): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  // ========== SCHEMA CHECKS ==========
  
  // email_outbox columns
  checks.push({
    id: "schema_email_columns",
    category: "Schema",
    label: "email_outbox required columns",
    level: snapshot.schema.email_outbox_columns_ok ? "PASS" : "FAIL",
    details: snapshot.schema.email_outbox_columns_ok 
      ? "All required columns present"
      : "Missing required columns",
    evidence: { columns_found: snapshot.schema.email_outbox_columns_found }
  });

  // email_outbox indexes - check specific names
  const emailIndexes = snapshot.schema.email_outbox_indexes_found || [];
  
  const hasOrgStatusNextIdx = hasIndex(emailIndexes, "org_status_next") || 
                               hasIndex(emailIndexes, "organization_id") && hasIndex(emailIndexes, "status");
  checks.push({
    id: "schema_email_idx_org_status",
    category: "Schema",
    label: "email_outbox index: org_status_next",
    level: hasOrgStatusNextIdx ? "PASS" : "FAIL",
    details: hasOrgStatusNextIdx 
      ? "Composite index for queue processing exists"
      : "Missing critical index for queue processing",
    evidence: { indexes_found: emailIndexes }
  });

  const hasProviderMsgIdx = hasIndex(emailIndexes, "provider_message_id");
  checks.push({
    id: "schema_email_idx_provider",
    category: "Schema",
    label: "email_outbox index: provider_message_id",
    level: hasProviderMsgIdx ? "PASS" : "FAIL",
    details: hasProviderMsgIdx 
      ? "Provider message lookup index exists"
      : "Missing index for provider message lookup",
    evidence: { indexes_found: emailIndexes }
  });

  // job_runs table
  checks.push({
    id: "schema_job_runs_table",
    category: "Schema",
    label: "job_runs table exists",
    level: snapshot.schema.job_runs_table_exists ? "PASS" : "FAIL",
    details: snapshot.schema.job_runs_table_exists 
      ? "Table exists for job tracking"
      : "Missing job_runs table",
    evidence: { exists: snapshot.schema.job_runs_table_exists }
  });

  // job_runs metadata column
  checks.push({
    id: "schema_job_runs_metadata",
    category: "Schema",
    label: "job_runs.metadata column",
    level: snapshot.schema.job_runs_has_metadata ? "PASS" : "WARN",
    details: snapshot.schema.job_runs_has_metadata 
      ? "Metadata column available for job context"
      : "Metadata column missing (preview flag unavailable)",
    evidence: { has_metadata: snapshot.schema.job_runs_has_metadata }
  });

  // system_health_events table
  checks.push({
    id: "schema_system_health_table",
    category: "Schema",
    label: "system_health_events table exists",
    level: snapshot.schema.system_health_events_table_exists ? "PASS" : "FAIL",
    details: snapshot.schema.system_health_events_table_exists 
      ? "Table exists for system health tracking"
      : "Missing system_health_events table",
    evidence: { exists: snapshot.schema.system_health_events_table_exists }
  });

  // ========== TRIGGER CHECKS ==========

  checks.push({
    id: "trigger_audit_function",
    category: "Triggers",
    label: "audit_trigger_write_audit_log() function",
    level: snapshot.triggers.audit_trigger_function_exists ? "PASS" : "FAIL",
    details: snapshot.triggers.audit_trigger_function_exists 
      ? "Audit trigger function installed"
      : "Missing audit trigger function",
    evidence: { exists: snapshot.triggers.audit_trigger_function_exists }
  });

  checks.push({
    id: "trigger_memberships",
    category: "Triggers",
    label: "organization_memberships triggers",
    level: snapshot.triggers.organization_memberships_triggers_ok ? "PASS" : "FAIL",
    details: snapshot.triggers.organization_memberships_triggers_ok 
      ? "Membership audit triggers installed"
      : "Missing membership audit triggers",
    evidence: { triggers_found: snapshot.triggers.triggers_found }
  });

  checks.push({
    id: "trigger_subscriptions",
    category: "Triggers",
    label: "subscriptions trigger",
    level: snapshot.triggers.subscriptions_trigger_ok ? "PASS" : "FAIL",
    details: snapshot.triggers.subscriptions_trigger_ok 
      ? "Subscription audit trigger installed"
      : "Missing subscription audit trigger",
    evidence: { triggers_found: snapshot.triggers.triggers_found }
  });

  checks.push({
    id: "trigger_email_outbox",
    category: "Triggers",
    label: "email_outbox trigger",
    level: snapshot.triggers.email_outbox_trigger_ok ? "PASS" : "FAIL",
    details: snapshot.triggers.email_outbox_trigger_ok 
      ? "Email outbox audit trigger installed"
      : "Missing email outbox audit trigger",
    evidence: { triggers_found: snapshot.triggers.triggers_found }
  });

  // ========== RLS CHECKS ==========

  checks.push({
    id: "rls_audit_logs",
    category: "RLS",
    label: "audit_logs RLS enabled",
    level: snapshot.rls.audit_logs_rls_enabled ? "PASS" : "FAIL",
    details: snapshot.rls.audit_logs_rls_enabled 
      ? `RLS enabled${snapshot.rls.audit_logs_rls_forced ? " (forced)" : ""}`
      : "RLS not enabled - CRITICAL SECURITY ISSUE",
    evidence: { 
      enabled: snapshot.rls.audit_logs_rls_enabled,
      forced: snapshot.rls.audit_logs_rls_forced 
    }
  });

  checks.push({
    id: "rls_organizations",
    category: "RLS",
    label: "organizations RLS enabled",
    level: snapshot.rls.organizations_rls_enabled ? "PASS" : "FAIL",
    details: snapshot.rls.organizations_rls_enabled 
      ? "RLS enabled for organization isolation"
      : "RLS not enabled - CRITICAL SECURITY ISSUE",
    evidence: { enabled: snapshot.rls.organizations_rls_enabled }
  });

  checks.push({
    id: "rls_subscriptions",
    category: "RLS",
    label: "subscriptions RLS enabled",
    level: snapshot.rls.subscriptions_rls_enabled ? "PASS" : "FAIL",
    details: snapshot.rls.subscriptions_rls_enabled 
      ? "RLS enabled for subscription access control"
      : "RLS not enabled - CRITICAL SECURITY ISSUE",
    evidence: { enabled: snapshot.rls.subscriptions_rls_enabled }
  });

  checks.push({
    id: "rls_admin_notifications",
    category: "RLS",
    label: "admin_notifications RLS enabled",
    level: snapshot.rls.admin_notifications_rls_enabled ? "PASS" : "FAIL",
    details: snapshot.rls.admin_notifications_rls_enabled 
      ? "RLS enabled for notification isolation"
      : "RLS not enabled",
    evidence: { enabled: snapshot.rls.admin_notifications_rls_enabled }
  });

  // ========== ACTIVITY CHECKS ==========

  const activityKeys = [
    "DB_MEMBERSHIP_INSERTED",
    "DB_MEMBERSHIP_UPDATED",
    "DB_MEMBERSHIP_DELETED",
    "DB_SUBSCRIPTION_UPDATED",
    "DB_EMAIL_STATUS_CHANGED"
  ] as const;

  let hasAnyActivity = false;
  for (const action of activityKeys) {
    const timestamp = snapshot.activity_last_seen[action];
    if (timestamp) hasAnyActivity = true;
    
    const level = getFreshnessLevel(timestamp);
    checks.push({
      id: `activity_${action.toLowerCase()}`,
      category: "Activity",
      label: `${action} last seen`,
      level,
      details: timestamp 
        ? `Last observed: ${new Date(timestamp).toLocaleString("es-CO")}`
        : "Never observed",
      evidence: { 
        timestamp,
        fresh: timestamp ? isWithinDays(timestamp, FRESHNESS_THRESHOLD_DAYS) : false
      }
    });
  }

  // If triggers exist but no activity, add a summary warning
  const triggersExist = snapshot.triggers.organization_memberships_triggers_ok ||
                        snapshot.triggers.subscriptions_trigger_ok ||
                        snapshot.triggers.email_outbox_trigger_ok;
  
  if (triggersExist && !hasAnyActivity) {
    checks.push({
      id: "activity_no_observed",
      category: "Activity",
      label: "Trigger activity never observed",
      level: "WARN",
      details: "Triggers are installed but no audit events have been recorded yet",
      evidence: { triggers_installed: true, activity_observed: false }
    });
  }

  // ========== JOBS CHECKS ==========

  const lastRun = snapshot.jobs.purge_old_audit_logs_last_run;
  const lastError = snapshot.jobs.purge_old_audit_logs_last_error;

  // Check if job has run recently
  if (!lastRun) {
    checks.push({
      id: "jobs_purge_last_run",
      category: "Jobs",
      label: "purge-old-audit-logs last run",
      level: "WARN",
      details: "Job has never run successfully",
      evidence: { last_run: null }
    });
  } else {
    const isStale = !isWithinDays(lastRun.finished_at, JOB_STALE_THRESHOLD_DAYS);
    checks.push({
      id: "jobs_purge_last_run",
      category: "Jobs",
      label: "purge-old-audit-logs last run",
      level: isStale ? "WARN" : "PASS",
      details: isStale 
        ? `Last run over ${JOB_STALE_THRESHOLD_DAYS} days ago`
        : `Last run: ${new Date(lastRun.finished_at).toLocaleString("es-CO")}`,
      evidence: {
        finished_at: lastRun.finished_at,
        duration_ms: lastRun.duration_ms,
        processed_count: lastRun.processed_count,
        preview: lastRun.preview
      }
    });
  }

  // Check for recent errors
  if (lastError && isWithinDays(lastError.finished_at, JOB_ERROR_THRESHOLD_DAYS)) {
    checks.push({
      id: "jobs_purge_recent_error",
      category: "Jobs",
      label: "purge-old-audit-logs recent error",
      level: "FAIL",
      details: `Error within last ${JOB_ERROR_THRESHOLD_DAYS} days: ${lastError.error}`,
      evidence: {
        finished_at: lastError.finished_at,
        error: lastError.error
      }
    });
  } else if (lastError) {
    checks.push({
      id: "jobs_purge_past_error",
      category: "Jobs",
      label: "purge-old-audit-logs past error",
      level: "WARN",
      details: `Historical error: ${lastError.error}`,
      evidence: {
        finished_at: lastError.finished_at,
        error: lastError.error
      }
    });
  }

  return checks;
}

/**
 * Evaluate probe results into verification checks
 */
export function evaluateProbes(probes: ProbeResult[]): VerificationCheck[] {
  return probes.map((probe, idx) => ({
    id: `probe_${probe.table}_${idx}`,
    category: "Probes" as const,
    label: probe.name,
    level: probe.passed ? "PASS" as const : "FAIL" as const,
    details: probe.passed 
      ? `Readable (${probe.rowCount ?? 0} records, ${probe.duration_ms}ms)`
      : `Error: ${probe.error}`,
    evidence: {
      table: probe.table,
      passed: probe.passed,
      row_count: probe.rowCount,
      duration_ms: probe.duration_ms,
      error: probe.error
    }
  }));
}

/**
 * Evaluate RLS negative probe results
 */
export function evaluateRlsNegativeProbe(result: {
  ok: boolean;
  policies?: Array<{
    table: string;
    has_platform_policy: boolean;
    has_org_policy: boolean;
  }>;
  error?: string;
}): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  if (!result.ok || result.error) {
    checks.push({
      id: "rls_negative_probe_error",
      category: "RLS",
      label: "RLS policy validation",
      level: "FAIL",
      details: result.error || "Failed to validate RLS policies",
      evidence: { error: result.error }
    });
    return checks;
  }

  for (const policy of result.policies || []) {
    const hasBoth = policy.has_platform_policy && policy.has_org_policy;
    checks.push({
      id: `rls_policy_${policy.table}`,
      category: "RLS",
      label: `${policy.table} policy structure`,
      level: hasBoth ? "PASS" : "FAIL",
      details: hasBoth 
        ? "Has both platform-admin and org-scoped policies"
        : `Missing ${!policy.has_platform_policy ? "platform-admin" : ""}${!policy.has_platform_policy && !policy.has_org_policy ? " and " : ""}${!policy.has_org_policy ? "org-scoped" : ""} policy`,
      evidence: policy
    });
  }

  return checks;
}

/**
 * Compute overall gate status from checks
 */
export function computeOverallStatus(checks: VerificationCheck[]): VerificationLevel {
  if (checks.some(c => c.level === "FAIL")) return "FAIL";
  if (checks.some(c => c.level === "WARN")) return "WARN";
  return "PASS";
}

/**
 * Count checks by level
 */
export function countByLevel(checks: VerificationCheck[]): { pass: number; warn: number; fail: number } {
  return {
    pass: checks.filter(c => c.level === "PASS").length,
    warn: checks.filter(c => c.level === "WARN").length,
    fail: checks.filter(c => c.level === "FAIL").length
  };
}

/**
 * Group checks by category
 */
export function groupByCategory(checks: VerificationCheck[]): Record<string, VerificationCheck[]> {
  const groups: Record<string, VerificationCheck[]> = {};
  for (const check of checks) {
    if (!groups[check.category]) groups[check.category] = [];
    groups[check.category].push(check);
  }
  return groups;
}

/**
 * Generate acceptance report
 */
export function generateAcceptanceReport(checks: VerificationCheck[]): AcceptanceReport {
  return {
    generated_at: new Date().toISOString(),
    overall: computeOverallStatus(checks),
    counts: countByLevel(checks),
    checks
  };
}

/**
 * Get recommendation message based on overall status
 */
export function getRecommendation(overall: VerificationLevel): string {
  switch (overall) {
    case "PASS":
      return "All verification checks passed. System is ready for production.";
    case "WARN":
      return "Some checks have warnings. Review before deploying to production.";
    case "FAIL":
      return "Critical checks failed. Do NOT deploy to production until resolved.";
  }
}
