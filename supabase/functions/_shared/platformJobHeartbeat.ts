/**
 * platformJobHeartbeat.ts — Shared helper for recording platform job heartbeats.
 *
 * Every scheduled edge function should call `startHeartbeat()` at the start
 * and `finishHeartbeat()` at the end. The watchdog queries `platform_job_heartbeats`
 * to detect missed, failed, or stuck jobs.
 *
 * P1.3 — HEARTBEAT COALESCING.
 * Successful runs no longer append a history row per execution. Each job keeps
 * exactly ONE current-state row (`is_current = true`, unique per job_name) that
 * is UPSERTed in place. FAILED/TIMEOUT runs remain append-only history
 * (`is_current = false`) so no failure is ever coalesced away.
 */

type SupabaseAdmin = { from: (table: string) => any };

const TABLE = "platform_job_heartbeats";

export interface HeartbeatHandle {
  id: string;
  job_name: string;
  started_at: string;
}

/**
 * Record start of a job execution. Returns a handle for finishHeartbeat().
 */
export async function startHeartbeat(
  supabase: SupabaseAdmin,
  jobName: string,
  invokedBy: string = "cron",
  metadata: Record<string, unknown> = {},
): Promise<HeartbeatHandle | null> {
  try {
    const started_at = new Date().toISOString();
    // Coalesced current-state row: one per job_name, updated in place.
    const { data } = await supabase
      .from(TABLE)
      .upsert(
        {
          current_key: jobName,
          job_name: jobName,
          invoked_by: invokedBy,
          started_at,
          finished_at: null,
          duration_ms: null,
          error_code: null,
          error_message: null,
          status: "RUNNING",
          is_current: true,
          metadata,
        },
        { onConflict: "current_key", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();
    return { id: data?.id ?? "", job_name: jobName, started_at };
  } catch (err) {
    console.warn(`[heartbeat] Failed to start heartbeat for ${jobName}:`, err);
    return null;
  }
}

/**
 * Record completion of a job execution.
 */
export async function finishHeartbeat(
  supabase: SupabaseAdmin,
  handle: HeartbeatHandle | null,
  status: "OK" | "ERROR" | "TIMEOUT" = "OK",
  options: {
    errorCode?: string;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (!handle) return;
  try {
    const now = new Date();
    const durationMs = now.getTime() - new Date(handle.started_at).getTime();
    // Current-state row always reflects the latest outcome…
    await supabase.from(TABLE).update({
      finished_at: now.toISOString(),
      status,
      duration_ms: durationMs,
      error_code: options.errorCode ?? null,
      error_message: options.errorMessage ?? null,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    }).eq("job_name", handle.job_name).eq("is_current", true);

    // …and every non-OK run additionally leaves an append-only history row.
    if (status !== "OK") {
      await supabase.from(TABLE).insert({
        job_name: handle.job_name,
        invoked_by: "cron",
        started_at: handle.started_at,
        finished_at: now.toISOString(),
        status,
        duration_ms: durationMs,
        error_code: options.errorCode ?? null,
        error_message: options.errorMessage ?? null,
        is_current: false,
        metadata: options.metadata ?? {},
      });
    }
  } catch (err) {
    console.warn(`[heartbeat] Failed to finish heartbeat for ${handle.job_name}:`, err);
  }
}

/**
 * P1.2 — no-op run marker.
 *
 * A scheduled run that found nothing to do writes NO telemetry history:
 * it only refreshes the single coalesced current-state row so the watchdog
 * can still tell the job is alive. Constant table size, zero row growth.
 */
export async function heartbeatNoOp(
  supabase: SupabaseAdmin,
  jobName: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await supabase.from(TABLE).upsert(
      {
        current_key: jobName,
        job_name: jobName,
        invoked_by: "cron",
        started_at: now,
        finished_at: now,
        status: "OK",
        duration_ms: 0,
        error_code: null,
        error_message: null,
        is_current: true,
        metadata: { ...metadata, no_op: true },
      },
      { onConflict: "current_key", ignoreDuplicates: false },
    );
  } catch (err) {
    console.warn(`[heartbeat] no-op marker failed for ${jobName}:`, err);
  }
}

// ─── Known jobs and their expected intervals (minutes) ───────────────

// P1.1 — intervals realigned to the reduced cron cadences. A stale expectation
// here turns every reduced job into a permanent false "missed job" alert.
export const KNOWN_PLATFORM_JOBS: Record<string, { label: string; expectedIntervalMinutes: number }> = {
  "scheduled-daily-sync":           { label: "Sync Diario",              expectedIntervalMinutes: 1440 },
  "scheduled-publicaciones-monitor": { label: "Monitor Publicaciones",   expectedIntervalMinutes: 1440 },
  "atenia-server-heartbeat":        { label: "Server Heartbeat",         expectedIntervalMinutes: 420 },
  "atenia-cron-watchdog":           { label: "Cron Watchdog",            expectedIntervalMinutes: 90 },
  "atenia-ai-supervisor":           { label: "AI Supervisor",            expectedIntervalMinutes: 1440 },
  "atenia-platform-sweep":          { label: "Platform Sweep",           expectedIntervalMinutes: 1440 },
  "atenia-self-health":             { label: "Self-Health Check",        expectedIntervalMinutes: 90 },
  "process-retry-queue":            { label: "Retry Queue Processor",    expectedIntervalMinutes: 25 },
  "atenia-daily-report":            { label: "Daily Ops Report",         expectedIntervalMinutes: 1440 },
  "global-master-sync":             { label: "Global Master Sync (Manual)", expectedIntervalMinutes: 0 },
};
