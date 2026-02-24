/**
 * Trace Context — Shared module for correlation ID propagation
 * across cron jobs, orchestrator, providers, and downstream effects.
 *
 * Usage:
 *   const trace = createTraceContext("scheduled-daily-sync", "CRON");
 *   // ... do work ...
 *   await writeTraceRecord(supabase, trace, "OK", { synced: 10 });
 */

export interface TraceContext {
  /** Unique ID for this cron invocation */
  cron_run_id: string;
  /** Canonical job name (matches cronRegistry) */
  job_name: string;
  /** How was this triggered */
  run_mode: "CRON" | "MANUAL" | "CONTINUATION" | "OVERFLOW" | "DRY_RUN";
  /** When the job was scheduled (UTC ISO) */
  scheduled_at: string;
  /** Organization scope (null = platform-wide) */
  org_id?: string;
  /** Chain ID for multi-continuation jobs */
  chain_id?: string;
}

export interface TraceDetails {
  /** High-level counters */
  work_items_scanned?: number;
  queue_items_enqueued?: number;
  /** Per-provider call counts */
  provider_calls?: Record<string, {
    count: number;
    inserted: number;
    skipped: number;
    errors: number;
    avg_latency_ms?: number;
  }>;
  /** Queue processing stats */
  queue_stats?: {
    depth_before?: number;
    depth_after?: number;
    processed?: number;
    succeeded?: number;
    rescheduled?: number;
    exhausted?: number;
    failed?: number;
  };
  /** Email dispatch stats */
  email_stats?: {
    pending_alerts?: number;
    emails_sent?: number;
    emails_failed?: number;
  };
  /** Error summary */
  errors?: Array<{ code: string; message: string; count: number }>;
  /** Arbitrary extra metadata */
  [key: string]: unknown;
}

/**
 * Create a new trace context for a cron job invocation.
 */
export function createTraceContext(
  jobName: string,
  runMode: TraceContext["run_mode"],
  opts?: { org_id?: string; chain_id?: string; cron_run_id?: string }
): TraceContext {
  return {
    cron_run_id: opts?.cron_run_id ?? crypto.randomUUID(),
    job_name: jobName,
    run_mode: runMode,
    scheduled_at: new Date().toISOString(),
    org_id: opts?.org_id,
    chain_id: opts?.chain_id,
  };
}

/**
 * Write a trace record to atenia_cron_runs.
 * The `details` JSONB column stores the full trace payload.
 */
export async function writeTraceRecord(
  supabase: any,
  trace: TraceContext,
  status: "OK" | "ERROR" | "PARTIAL" | "TIMEOUT",
  details: TraceDetails,
  startedAt: Date,
  finishedAt?: Date,
): Promise<void> {
  const now = finishedAt ?? new Date();
  try {
    await supabase.from("atenia_cron_runs").insert({
      id: trace.cron_run_id,
      job_name: trace.job_name,
      scheduled_for: trace.scheduled_at,
      started_at: startedAt.toISOString(),
      finished_at: now.toISOString(),
      status,
      details: {
        run_mode: trace.run_mode,
        org_id: trace.org_id ?? null,
        chain_id: trace.chain_id ?? null,
        duration_ms: now.getTime() - startedAt.getTime(),
        ...details,
      },
    });
  } catch (err) {
    console.warn(`[traceContext] Failed to write trace record for ${trace.job_name}:`, err);
  }
}
