/**
 * lifecycle.ts — Canonical edge-runtime helper for work_item lifecycle
 *
 * Mirrors src/lib/lifecycle.ts. Every edge function that mutates
 * monitoring/deletion state MUST use `setWorkItemLifecycle` (which calls the
 * DB RPC `set_work_item_lifecycle`). Direct UPDATEs to
 * monitoring_enabled/scraping_enabled/deleted_at/status are forbidden.
 *
 * States: ACTIVE | PAUSED | CLOSED | ARCHIVED | DELETED
 */

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

export function isActive(wi: LifecycleFlags): boolean {
  if (wi.lifecycle_state) return wi.lifecycle_state === "ACTIVE";
  return !!wi.monitoring_enabled && !wi.deleted_at;
}

export function isSyncEligible(wi: LifecycleFlags): boolean {
  return isActive(wi);
}

export function isVisibleInList(wi: LifecycleFlags): boolean {
  const s = wi.lifecycle_state;
  if (s) return s === "ACTIVE" || s === "PAUSED" || s === "CLOSED";
  return !wi.deleted_at;
}

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

// deno-lint-ignore no-explicit-any
export async function setWorkItemLifecycle(
  supabase: any,
  args: SetLifecycleArgs,
): Promise<SetLifecycleResult> {
  const { data, error } = await supabase.rpc("set_work_item_lifecycle", {
    p_work_item_id: args.workItemId,
    p_new_state: args.newState,
    p_reason: args.reason ?? null,
    p_actor: args.actor ?? "SYSTEM",
    p_actor_user: args.actorUserId ?? null,
    p_metadata: args.metadata ?? {},
  });
  if (error) return { ok: false, error: error.message };
  return (data ?? { ok: true }) as SetLifecycleResult;
}

export async function bulkSetLifecycle(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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

/**
 * Directly enqueue a GCP outbox event without touching lifecycle_state.
 * Used ONLY by hard-delete paths (delete-work-items HARD_DELETE,
 * purge-organization-data) that physically remove the row and therefore
 * cannot rely on the trigger inside `set_work_item_lifecycle`.
 */
export async function enqueueGcpLifecycleForHardDelete(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: {
    id: string;
    radicado: string | null;
    workflow_type: string | null;
    lifecycle_state?: WorkItemLifecycleState | null;
    organization_id?: string | null;
  },
  actor: LifecycleActor,
  actorUserId: string | null,
  reason: string,
): Promise<void> {
  await supabase.from("gcp_lifecycle_outbox").insert({
    work_item_id: row.id,
    radicado: row.radicado,
    workflow_type: row.workflow_type,
    prev_state: row.lifecycle_state ?? "ACTIVE",
    new_state: "DELETED",
    reason,
    actor,
    actor_user_id: actorUserId,
    metadata: { hard_delete: true },
    occurred_at: new Date().toISOString(),
  });
}