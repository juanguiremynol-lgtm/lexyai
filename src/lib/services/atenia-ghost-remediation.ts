/**
 * atenia-ghost-remediation.ts — Ghost Item Identification & Remediation
 *
 * Ops Hardening D:
 * - Identifies ghost items (monitored, no sync attempts) with work_item_id + radicado.
 * - Bootstraps initial sync for each ghost.
 * - Quarantines items that fail bootstrap with ITEM_NOT_FOUND.
 * - Deduplicates GHOST_ITEMS_WIRING warnings (at most once per 6h unless set changes).
 */

import { supabase } from "@/integrations/supabase/client";

const GHOST_WARNING_DEDUPE_HOURS = 6;

export interface GhostItem {
  work_item_id: string;
  radicado: string;
  workflow_type: string;
  created_at: string;
}

export interface GhostRemediationResult {
  ghost_items: GhostItem[];
  bootstrapped: number;
  quarantined: number;
  warning_emitted: boolean;
}

/**
 * Identify, remediate, and report ghost items for an organization.
 * Called during heartbeat cycle.
 */
export async function remediateGhostItems(orgId: string): Promise<GhostRemediationResult> {
  const result: GhostRemediationResult = {
    ghost_items: [],
    bootstrapped: 0,
    quarantined: 0,
    warning_emitted: false,
  };

  // Find monitored items with zero sync attempts
  const { data: ghosts } = await (supabase.from("work_items") as any)
    .select("id, radicado, workflow_type, created_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .is("last_attempted_sync_at", null)
    .limit(20);

  if (!ghosts || ghosts.length === 0) return result;

  result.ghost_items = ghosts.map((g: any) => ({
    work_item_id: g.id,
    radicado: g.radicado,
    workflow_type: g.workflow_type,
    created_at: g.created_at,
  }));

  // Check dedup: was a warning emitted recently for the same set?
  const ghostIds = ghosts.map((g: any) => g.id).sort().join(",");
  const shouldEmitWarning = await shouldEmitGhostWarning(orgId, ghostIds);

  // Bootstrap sync for each ghost
  for (const ghost of ghosts) {
    try {
      const { data: syncResult, error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: ghost.id, trigger: "GHOST_BOOTSTRAP" },
      });

      if (syncErr || syncResult?.error?.includes("not found") || syncResult?.error?.includes("NOT_FOUND")) {
        // Quarantine: disable monitoring with reason
        await (supabase.from("work_items") as any)
          .update({
            monitoring_enabled: false,
            monitoring_disabled_reason: "GHOST_QUARANTINE_ITEM_NOT_FOUND",
            monitoring_disabled_by: "ATENIA",
            monitoring_disabled_at: new Date().toISOString(),
            monitoring_disabled_meta: {
              ghost_bootstrap_error: syncErr?.message || syncResult?.error,
              quarantined_at: new Date().toISOString(),
            },
          })
          .eq("id", ghost.id);

        result.quarantined++;
      } else {
        result.bootstrapped++;
      }
    } catch {
      // Non-blocking per item
    }
  }

  // Emit deduped warning (only if set changed or time window expired)
  if (shouldEmitWarning && result.ghost_items.length > 0) {
    try {
      await (supabase.from("atenia_ai_actions") as any).insert({
        organization_id: orgId,
        action_type: "GHOST_ITEMS_REMEDIATION",
        actor: "AI_AUTOPILOT",
        autonomy_tier: "ACT",
        reasoning: `${result.ghost_items.length} asuntos fantasma identificados. Bootstrap: ${result.bootstrapped} OK, ${result.quarantined} en cuarentena. IDs: ${result.ghost_items.map(g => `${g.radicado}(${g.work_item_id.slice(0, 8)})`).join(", ")}`,
        action_result: "applied",
        status: "EXECUTED",
        evidence: {
          ghost_item_ids: result.ghost_items.map(g => g.work_item_id),
          ghost_radicados: result.ghost_items.map(g => g.radicado),
          bootstrapped: result.bootstrapped,
          quarantined: result.quarantined,
          ghost_fingerprint: ghostIds.slice(0, 100),
        },
      });
      result.warning_emitted = true;
    } catch { /* best-effort */ }
  }

  return result;
}

/**
 * Check if we should emit a new ghost warning (dedup logic).
 */
async function shouldEmitGhostWarning(orgId: string, currentFingerprint: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - GHOST_WARNING_DEDUPE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: recent } = await (supabase.from("atenia_ai_actions") as any)
    .select("evidence")
    .eq("organization_id", orgId)
    .eq("action_type", "GHOST_ITEMS_REMEDIATION")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!recent) return true; // No recent warning → emit

  // Compare fingerprint: if ghost set changed, emit
  const lastFingerprint = (recent.evidence as any)?.ghost_fingerprint ?? "";
  return lastFingerprint !== currentFingerprint.slice(0, 100);
}
