/**
 * platformJobHeartbeat.ts — Shared helper for recording platform job heartbeats.
 *
 * Every scheduled edge function should call `startHeartbeat()` at the start
 * and `finishHeartbeat()` at the end. The watchdog queries `platform_job_heartbeats`
 * to detect missed, failed, or stuck jobs.
 */

type SupabaseAdmin = { from: (table: string) => any };

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
    const id = crypto.randomUUID();
    const started_at = new Date().toISOString();
    await supabase.from("platform_job_heartbeats").insert({
      id,
      job_name: jobName,
      invoked_by: invokedBy,
      started_at,
      status: "RUNNING",
      metadata,
    });
    return { id, job_name: jobName, started_at };
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
    await supabase.from("platform_job_heartbeats").update({
      finished_at: now.toISOString(),
      status,
      duration_ms: durationMs,
      error_code: options.errorCode ?? null,
      error_message: options.errorMessage ?? null,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    }).eq("id", handle.id);
  } catch (err) {
    console.warn(`[heartbeat] Failed to finish heartbeat for ${handle.job_name}:`, err);
  }
}

// ─── Known jobs and their expected intervals (minutes) ───────────────

export const KNOWN_PLATFORM_JOBS: Record<string, { label: string; expectedIntervalMinutes: number }> = {
  "scheduled-daily-sync":           { label: "Sync Diario",              expectedIntervalMinutes: 1440 },
  "scheduled-publicaciones-monitor": { label: "Monitor Publicaciones",   expectedIntervalMinutes: 1440 },
  "atenia-server-heartbeat":        { label: "Server Heartbeat",         expectedIntervalMinutes: 35 },
  "atenia-cron-watchdog":           { label: "Cron Watchdog",            expectedIntervalMinutes: 15 },
  "atenia-ai-supervisor":           { label: "AI Supervisor",            expectedIntervalMinutes: 35 },
  "atenia-platform-sweep":          { label: "Platform Sweep",           expectedIntervalMinutes: 1440 },
  "atenia-self-health":             { label: "Self-Health Check",        expectedIntervalMinutes: 20 },
  "process-retry-queue":            { label: "Retry Queue Processor",    expectedIntervalMinutes: 5 },
  "atenia-daily-report":            { label: "Daily Ops Report",         expectedIntervalMinutes: 1440 },
  "global-master-sync":             { label: "Global Master Sync (Manual)", expectedIntervalMinutes: 0 },
};
