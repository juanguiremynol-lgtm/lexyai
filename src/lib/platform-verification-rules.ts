/**
 * Platform Verification Rules
 * 
 * Deterministic PASS/FAIL/WARN evaluation logic for production acceptance tests
 * with context-aware suppression of WARNs for inactive features
 */

import type { 
  VerificationSnapshot, 
  ProbeResult, 
  UsageCounts,
  JobRunEvidence,
  JobMismatchType
} from "./platform-verification";
import { detectJobMismatch, getMismatchHint } from "./platform-verification";

export type VerificationLevel = "PASS" | "WARN" | "FAIL";

export type VerificationCheck = {
  id: string;
  category: "Schema" | "Triggers" | "RLS" | "Activity" | "Jobs" | "Probes" | "Context";
  label: string;
  level: VerificationLevel;
  details?: string;
  evidence?: Record<string, unknown>;
  mismatchType?: JobMismatchType;
  mismatchHint?: string;
};

export interface AcceptanceReport {
  generated_at: string;
  overall: VerificationLevel;
  counts: { pass: number; warn: number; fail: number };
  checks: VerificationCheck[];
  usage?: UsageCounts;
  jobs_evidence?: {
    expected_signature: { job_name: string; success_status: string };
    last_seen_exact: JobRunEvidence | null;
    last_seen_fuzzy: JobRunEvidence | null;
    recent_job_names: string[];
  };
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
 * Get freshness status for a timestamp with context-aware suppression
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
 * Context-aware activity check helpers
 */
function isSingleMemberEnvironment(usage: UsageCounts): boolean {
  return usage.memberships_total <= 1 && usage.organizations_total <= 1;
}

function isEmailPipelineInactive(usage: UsageCounts): boolean {
  return usage.email_outbox_total === 0;
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

  // ========== ACTIVITY CHECKS (Context-Aware) ==========

  const usage = snapshot.usage;
  const singleMemberEnv = isSingleMemberEnvironment(usage);
  const emailInactive = isEmailPipelineInactive(usage);

  // Membership activity checks with context-aware suppression
  const membershipActions = ["DB_MEMBERSHIP_INSERTED", "DB_MEMBERSHIP_DELETED"] as const;
  for (const action of membershipActions) {
    const timestamp = snapshot.activity_last_seen[action];
    let level: VerificationLevel;
    let details: string;
    
    if (!timestamp && singleMemberEnv) {
      // Suppress WARN in single-member environment
      level = "PASS";
      details = "Single-member environment: membership churn not expected yet.";
    } else if (!timestamp) {
      level = "WARN";
      details = "Never observed";
    } else {
      level = getFreshnessLevel(timestamp);
      details = `Last observed: ${new Date(timestamp).toLocaleString("es-CO")}`;
    }
    
    checks.push({
      id: `activity_${action.toLowerCase()}`,
      category: "Activity",
      label: `${action} last seen`,
      level,
      details,
      evidence: { 
        timestamp,
        fresh: timestamp ? isWithinDays(timestamp, FRESHNESS_THRESHOLD_DAYS) : false,
        single_member_env: singleMemberEnv
      }
    });
  }

  // Membership UPDATE - always relevant
  const membershipUpdatedTs = snapshot.activity_last_seen.DB_MEMBERSHIP_UPDATED;
  checks.push({
    id: "activity_db_membership_updated",
    category: "Activity",
    label: "DB_MEMBERSHIP_UPDATED last seen",
    level: getFreshnessLevel(membershipUpdatedTs),
    details: membershipUpdatedTs 
      ? `Last observed: ${new Date(membershipUpdatedTs).toLocaleString("es-CO")}`
      : "Never observed",
    evidence: { 
      timestamp: membershipUpdatedTs,
      fresh: membershipUpdatedTs ? isWithinDays(membershipUpdatedTs, FRESHNESS_THRESHOLD_DAYS) : false
    }
  });

  // Subscription UPDATE - always relevant
  const subscriptionTs = snapshot.activity_last_seen.DB_SUBSCRIPTION_UPDATED;
  checks.push({
    id: "activity_db_subscription_updated",
    category: "Activity",
    label: "DB_SUBSCRIPTION_UPDATED last seen",
    level: getFreshnessLevel(subscriptionTs),
    details: subscriptionTs 
      ? `Last observed: ${new Date(subscriptionTs).toLocaleString("es-CO")}`
      : "Never observed",
    evidence: { 
      timestamp: subscriptionTs,
      fresh: subscriptionTs ? isWithinDays(subscriptionTs, FRESHNESS_THRESHOLD_DAYS) : false
    }
  });

  // Email status change - context-aware based on email_outbox_total
  const emailStatusTs = snapshot.activity_last_seen.DB_EMAIL_STATUS_CHANGED;
  let emailLevel: VerificationLevel;
  let emailDetails: string;
  
  if (!emailStatusTs && emailInactive) {
    // Suppress WARN when email pipeline is inactive
    emailLevel = "PASS";
    emailDetails = `No outbox traffic observed yet (0 records). Email pipeline not active.`;
  } else if (!emailStatusTs) {
    emailLevel = "WARN";
    emailDetails = "Never observed";
  } else {
    emailLevel = getFreshnessLevel(emailStatusTs);
    emailDetails = `Last observed: ${new Date(emailStatusTs).toLocaleString("es-CO")}`;
  }
  
  checks.push({
    id: "activity_db_email_status_changed",
    category: "Activity",
    label: "DB_EMAIL_STATUS_CHANGED last seen",
    level: emailLevel,
    details: emailDetails,
    evidence: { 
      timestamp: emailStatusTs,
      fresh: emailStatusTs ? isWithinDays(emailStatusTs, FRESHNESS_THRESHOLD_DAYS) : false,
      email_outbox_total: usage.email_outbox_total
    }
  });

  // Summary check for triggers with no activity (context-aware)
  const triggersExist = snapshot.triggers.organization_memberships_triggers_ok ||
                        snapshot.triggers.subscriptions_trigger_ok ||
                        snapshot.triggers.email_outbox_trigger_ok;
  
  const hasAnyActivity = membershipUpdatedTs || subscriptionTs || emailStatusTs ||
                         snapshot.activity_last_seen.DB_MEMBERSHIP_INSERTED ||
                         snapshot.activity_last_seen.DB_MEMBERSHIP_DELETED;
  
  if (triggersExist && !hasAnyActivity && !singleMemberEnv) {
    checks.push({
      id: "activity_no_observed",
      category: "Activity",
      label: "Trigger activity never observed",
      level: "WARN",
      details: "Triggers are installed but no audit events have been recorded yet",
      evidence: { triggers_installed: true, activity_observed: false }
    });
  }

  // ========== JOBS CHECKS (Evidence-Aware) ==========

  const jobs = snapshot.jobs;
  const lastRun = jobs.purge_old_audit_logs_last_run;
  const lastError = jobs.purge_old_audit_logs_last_error;
  const lastSeenExact = jobs.purge_old_audit_logs_last_seen_exact;
  const lastSeenFuzzy = jobs.purge_old_audit_logs_last_seen_fuzzy;
  const expectedJobName = jobs.expected_signature?.job_name || 'purge-old-audit-logs';

  // FAIL: job_runs table missing
  if (!jobs.job_runs_table_exists) {
    checks.push({
      id: "jobs_purge_table_missing",
      category: "Jobs",
      label: "purge-old-audit-logs job tracking",
      level: "FAIL",
      details: "job_runs table does not exist - cannot track job history",
      mismatchType: "TABLE_MISSING",
      mismatchHint: getMismatchHint("TABLE_MISSING"),
      evidence: { job_runs_table_exists: false }
    });
  } else {
    // Determine mismatch type if no success
    const mismatchType = !lastRun ? detectJobMismatch(lastSeenExact, lastSeenFuzzy, expectedJobName) : null;

    // Check if job has run successfully
    if (!lastRun) {
      // Build evidence-aware details
      let details = "Job has never run successfully.";
      
      if (lastSeenExact) {
        details = `Last exact record: job_name='${lastSeenExact.job_name}', status='${lastSeenExact.status}'`;
        if (!lastSeenExact.finished_at) {
          details += ", finished_at=NULL";
        }
      } else if (lastSeenFuzzy) {
        details = `Found fuzzy match: job_name='${lastSeenFuzzy.job_name}' (expected '${expectedJobName}'), status='${lastSeenFuzzy.status}'`;
      }

      checks.push({
        id: "jobs_purge_last_run",
        category: "Jobs",
        label: "purge-old-audit-logs last run",
        level: "WARN",
        details,
        mismatchType,
        mismatchHint: mismatchType ? getMismatchHint(mismatchType) : undefined,
        evidence: { 
          last_run: null,
          last_seen_exact: lastSeenExact,
          last_seen_fuzzy: lastSeenFuzzy,
          expected_job_name: expectedJobName,
          mismatch_type: mismatchType
        }
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
  }

  // Check for recent errors (FAIL if within 7 days)
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
 * Generate acceptance report with usage context and jobs evidence
 */
export function generateAcceptanceReport(
  checks: VerificationCheck[], 
  usage?: UsageCounts,
  jobsEvidence?: {
    expected_signature: { job_name: string; success_status: string };
    last_seen_exact: JobRunEvidence | null;
    last_seen_fuzzy: JobRunEvidence | null;
    recent_job_names: string[];
  }
): AcceptanceReport {
  return {
    generated_at: new Date().toISOString(),
    overall: computeOverallStatus(checks),
    counts: countByLevel(checks),
    checks,
    usage,
    jobs_evidence: jobsEvidence
  };
}

/**
 * Generate usage context checks for display
 */
export function generateUsageChecks(usage: UsageCounts): VerificationCheck[] {
  return [
    {
      id: "context_organizations",
      category: "Context",
      label: "Organizations",
      level: "PASS",
      details: `${usage.organizations_total} organization(s) in system`,
      evidence: { count: usage.organizations_total }
    },
    {
      id: "context_memberships",
      category: "Context",
      label: "Memberships",
      level: "PASS",
      details: `${usage.memberships_total} membership(s) across ${usage.distinct_users_total} user(s)`,
      evidence: { memberships: usage.memberships_total, users: usage.distinct_users_total }
    },
    {
      id: "context_email_outbox",
      category: "Context",
      label: "Email Outbox Records",
      level: "PASS",
      details: usage.email_outbox_total === 0 
        ? "No email traffic yet (pipeline inactive)" 
        : `${usage.email_outbox_total} record(s) in outbox`,
      evidence: { count: usage.email_outbox_total }
    },
    {
      id: "context_audit_logs",
      category: "Context",
      label: "Audit Logs",
      level: "PASS",
      details: `${usage.audit_logs_total} audit log record(s)`,
      evidence: { count: usage.audit_logs_total }
    },
    {
      id: "context_job_runs",
      category: "Context",
      label: "Job Runs",
      level: "PASS",
      details: usage.job_runs_total === 0 
        ? "No job runs yet" 
        : `${usage.job_runs_total} job run record(s)`,
      evidence: { count: usage.job_runs_total }
    }
  ];
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
