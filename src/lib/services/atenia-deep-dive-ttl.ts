/**
 * atenia-deep-dive-ttl.ts — Deep Dive TTL, Dedup & Heartbeat
 *
 * Ops Hardening B:
 * - Enforces max_runtime TTL (20 min default) for RUNNING deep dives.
 * - Deduplicates triggers per (radicado, trigger_reason) in a 6h window.
 * - Provides heartbeat update for in-progress dives.
 */

import { supabase } from "@/integrations/supabase/client";

const DEFAULT_MAX_RUNTIME_MS = 30 * 60 * 1000; // 30 minutes (Fix D: increased from 20)
const DEDUPE_WINDOW_HOURS = 6;

/**
 * Enforce TTL on all RUNNING deep dives that exceed their max_runtime.
 * Should be called every heartbeat cycle (30 min).
 * Returns count of timed-out dives.
 */
export async function enforceDeepDiveTTL(): Promise<number> {
  const now = new Date();

  // Find all RUNNING dives
  const { data: runningDives } = await (supabase.from("atenia_deep_dives") as any)
    .select("id, started_at, max_runtime_ms, last_heartbeat_at, work_item_id, radicado, trigger_criteria")
    .eq("status", "RUNNING");

  if (!runningDives || runningDives.length === 0) return 0;

  let timedOut = 0;

  for (const dive of runningDives) {
    const maxRuntime = dive.max_runtime_ms ?? DEFAULT_MAX_RUNTIME_MS;
    const startedAt = new Date(dive.started_at).getTime();
    const elapsed = now.getTime() - startedAt;

    if (elapsed > maxRuntime) {
      // Determine if stuck worker (no heartbeat in 5 min) vs slow provider
      const lastHb = dive.last_heartbeat_at ? new Date(dive.last_heartbeat_at).getTime() : startedAt;
      const hbAge = now.getTime() - lastHb;
      const isStuckWorker = hbAge > 5 * 60 * 1000;

      await (supabase.from("atenia_deep_dives") as any)
        .update({
          status: "TIMED_OUT",
          root_cause: "DEEP_DIVE_TTL_EXCEEDED",
          diagnosis: `Deep dive excedió TTL de ${Math.round(maxRuntime / 60000)}min (elapsed: ${Math.round(elapsed / 60000)}min). ${isStuckWorker ? "Worker posiblemente atascado (sin heartbeat en 5+ min)." : "Proveedor lento pero worker activo."}`,
          finished_at: now.toISOString(),
          duration_ms: elapsed,
        })
        .eq("id", dive.id);

      timedOut++;
    }
  }

  return timedOut;
}

/**
 * Check if a deep dive is already active for the same (work_item_id, trigger_criteria)
 * within the dedup window. If so, attach the new trigger as an observation.
 * Returns the existing dive ID if deduped, null if no duplicate.
 */
export async function deduplicateDeepDiveTrigger(
  workItemId: string,
  triggerCriteria: string,
  triggerEvidence: Record<string, any> = {}
): Promise<string | null> {
  const windowStart = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: existingDive } = await (supabase.from("atenia_deep_dives") as any)
    .select("id, status, trigger_evidence")
    .eq("work_item_id", workItemId)
    .eq("trigger_criteria", triggerCriteria)
    .in("status", ["RUNNING", "COMPLETED", "ESCALATED"])
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!existingDive) return null;

  // Attach new trigger as additional evidence
  const updatedEvidence = {
    ...(existingDive.trigger_evidence || {}),
    additional_triggers: [
      ...((existingDive.trigger_evidence as any)?.additional_triggers || []),
      { at: new Date().toISOString(), evidence: triggerEvidence },
    ],
  };

  await (supabase.from("atenia_deep_dives") as any)
    .update({ trigger_evidence: updatedEvidence })
    .eq("id", existingDive.id);

  return existingDive.id;
}

/**
 * Update heartbeat for an in-progress deep dive.
 */
export async function updateDeepDiveHeartbeat(diveId: string): Promise<void> {
  await (supabase.from("atenia_deep_dives") as any)
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("id", diveId)
    .eq("status", "RUNNING");
}
