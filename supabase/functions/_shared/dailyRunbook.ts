/**
 * Daily Runbook — Canonical definition of Atenia AI's daily job sequence.
 *
 * This is the SINGLE SOURCE OF TRUTH for what jobs run, in what order,
 * and how to verify them. Both cron triggers and manual "Run Runbook"
 * use the same definitions to prevent drift.
 */

export interface RunbookStep {
  /** Unique job key (matches atenia_cron_runs.job_name) */
  job_name: string;
  /** Human label for UI */
  label: string;
  /** Edge function to invoke */
  edge_function: string;
  /** Request body */
  body: Record<string, unknown>;
  /** Max seconds before considering the step timed out */
  timeout_seconds: number;
  /** DB table to check for proof of execution */
  proof_table: string;
  /** Short description of success criteria */
  success_criteria: string;
  /** Evidence query hint (for diagnostics) */
  evidence_hint: string;
}

/**
 * The canonical daily runbook steps, in execution order.
 * Each step is idempotent via atenia_try_start_cron leases.
 */
export const DAILY_RUNBOOK: RunbookStep[] = [
  {
    job_name: "DAILY_ENQUEUE",
    label: "Encolamiento diario",
    edge_function: "scheduled-daily-sync",
    body: { scope: "MONITORING_ONLY", _scheduled: true },
    timeout_seconds: 150,
    proof_table: "auto_sync_daily_ledger",
    success_criteria: "Ledger entries created for all orgs with monitored items",
    evidence_hint: "SELECT * FROM auto_sync_daily_ledger WHERE run_date = today ORDER BY created_at DESC LIMIT 20",
  },
  {
    job_name: "PROCESS_QUEUE",
    label: "Drenaje de cola",
    edge_function: "atenia-ai-supervisor",
    body: { mode: "PROCESS_QUEUE", max: 50 },
    timeout_seconds: 150,
    proof_table: "atenia_ai_remediation_queue",
    success_criteria: "PENDING count decreased or reached 0",
    evidence_hint: "SELECT status, count(*) FROM atenia_ai_remediation_queue GROUP BY status",
  },
  {
    job_name: "HEARTBEAT",
    label: "Heartbeat de salud",
    edge_function: "atenia-ai-supervisor",
    body: { mode: "HEARTBEAT" },
    timeout_seconds: 150,
    proof_table: "atenia_cron_runs",
    success_criteria: "HEARTBEAT cron_run with status OK for current window",
    evidence_hint: "SELECT * FROM atenia_cron_runs WHERE job_name='HEARTBEAT' ORDER BY started_at DESC LIMIT 5",
  },
  {
    job_name: "WATCHDOG",
    label: "Watchdog auto-sanación",
    edge_function: "atenia-cron-watchdog",
    body: {},
    timeout_seconds: 150,
    proof_table: "atenia_cron_runs",
    success_criteria: "WATCHDOG cron_run with status OK, coverage invariant checked",
    evidence_hint: "SELECT * FROM atenia_cron_runs WHERE job_name='WATCHDOG' ORDER BY started_at DESC LIMIT 5",
  },
  {
    job_name: "EMAIL_DISPATCH",
    label: "Despacho de emails",
    edge_function: "dispatch-update-emails",
    body: {},
    timeout_seconds: 60,
    proof_table: "email_outbox",
    success_criteria: "Unsent alert_instances processed, email_outbox entries created",
    evidence_hint: "SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 10",
  },
];

/** Map of job_name → step for quick lookup */
export const RUNBOOK_MAP = new Map(DAILY_RUNBOOK.map(s => [s.job_name, s]));

/** All job names for validation */
export const RUNBOOK_JOB_NAMES = DAILY_RUNBOOK.map(s => s.job_name);
