/**
 * lifecycle.ts — Canonical client-side helper for work_item lifecycle
 *
 * Single source of truth. Every writer that changes monitoring/deletion state
 * MUST go through `setWorkItemLifecycle` (which calls the DB RPC
 * `set_work_item_lifecycle`). Direct UPDATEs to
 * monitoring_enabled/scraping_enabled/deleted_at/status are forbidden and
 * will be blocked by the DB guardian trigger in a follow-up hardening.
 *
 * States: ACTIVE | PAUSED | CLOSED | ARCHIVED | DELETED
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkItemLifecycleState =
  | "ACTIVE"
  | "PAUSED"
  | "CLOSED"
  | "ARCHIVED"
  | "DELETED";

export type LifecycleActor = "USER" | "AI" | "SYSTEM" | "ADMIN";

export interface LifecycleFlags {
  lifecycle_state?: WorkItemLifecycleState | null;
  monitoring_enabled?: boolean | null;
  deleted_at?: string | null;
}

/** ACTIVE = the only live state. */
export function isActive(wi: LifecycleFlags): boolean {
  if (wi.lifecycle_state) return wi.lifecycle_state === "ACTIVE";
  return !!wi.monitoring_enabled && !wi.deleted_at;
}

/** Eligible for automated sync sweeps. Only ACTIVE items sync. */
export function isSyncEligible(wi: LifecycleFlags): boolean {
  return isActive(wi);
}

/** Visible in the main operational lists (ACTIVE + PAUSED + CLOSED). */
export function isVisibleInList(wi: LifecycleFlags): boolean {
  const s = wi.lifecycle_state;
  if (s) return s === "ACTIVE" || s === "PAUSED" || s === "CLOSED";
  return !wi.deleted_at;
}

/** Soft-deleted and still within the 10-day recovery window. */
export function isRecoverable(
  wi: LifecycleFlags & { purge_after?: string | null },
): boolean {
  if (wi.lifecycle_state) {
    if (wi.lifecycle_state !== "DELETED") return false;
  } else if (!wi.deleted_at) {
    return false;
  }
  if (!wi.purge_after) return true;
  return new Date(wi.purge_after).getTime() > Date.now();
}

export interface SetLifecycleArgs {
  workItemId: string;
  newState: WorkItemLifecycleState;
  reason?: string | null;
  actor?: LifecycleActor;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SetLifecycleResult {
  ok: boolean;
  prev_state?: WorkItemLifecycleState;
  new_state?: WorkItemLifecycleState;
  no_op?: boolean;
  work_item_id?: string;
  error?: string;
}

export async function setWorkItemLifecycle(
  supabase: SupabaseClient,
  args: SetLifecycleArgs,
): Promise<SetLifecycleResult> {
  const { data, error } = await (supabase as any).rpc(
    "set_work_item_lifecycle",
    {
      p_work_item_id: args.workItemId,
      p_new_state: args.newState,
      p_reason: args.reason ?? null,
      p_actor: args.actor ?? "USER",
      p_actor_user: args.actorUserId ?? null,
      p_metadata: args.metadata ?? {},
    },
  );
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: true }) as SetLifecycleResult;
}

export async function bulkSetLifecycle(
  supabase: SupabaseClient,
  ids: string[],
  base: Omit<SetLifecycleArgs, "workItemId">,
): Promise<{ ok: boolean; results: Array<SetLifecycleResult & { id: string }>; errors: number }> {
  const results: Array<SetLifecycleResult & { id: string }> = [];
  let errors = 0;
  for (const id of ids) {
    const r = await setWorkItemLifecycle(supabase, { ...base, workItemId: id });
    results.push({ ...r, id });
    if (!r.ok) errors++;
  }
  return { ok: errors === 0, results, errors };
}