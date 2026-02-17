/**
 * atenia-continuation-guarantee.ts — Continuation Guarantee for BUDGET_EXHAUSTED
 *
 * Ops Hardening E:
 * - Guarantees a BUDGET_EXHAUSTED chain either gets a continuation or a recorded block reason.
 * - Adds continuation_enqueued / continuation_block_reason telemetry to the ledger.
 * - Raises WARNING observation if chain ends PARTIAL without continuation.
 */

import { supabase } from "@/integrations/supabase/client";

const MAX_CONTINUATIONS_PER_DAY = 3;

export type ContinuationBlockReason =
  | "MAX_CONTINUATIONS_REACHED"
  | "NO_PENDING_WORK"
  | "POLICY_DISABLED"
  | "CONVERGENCE_FAILED"
  | "UNKNOWN";

export interface ContinuationCheckResult {
  continuation_enqueued: boolean;
  block_reason: ContinuationBlockReason | null;
  ledger_id: string;
  warning_raised: boolean;
}

/**
 * Evaluate PARTIAL chains for today and ensure no silent stops.
 * Called during the autonomy cycle.
 */
export async function guaranteeContinuation(orgId: string): Promise<ContinuationCheckResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const results: ContinuationCheckResult[] = [];

  // Fix A: Find PARTIAL chains with BUDGET_EXHAUSTED or skipped/timed-out items
  // Now also check for chains that ended PARTIAL regardless of continuation status
  const { data: partials } = await (supabase.from("auto_sync_daily_ledger") as any)
    .select("id, cursor_last_work_item_id, items_succeeded, items_failed, items_skipped, timeout_count, failure_reason, continuation_enqueued, continuation_block_reason, chain_id, expected_total_items")
    .eq("organization_id", orgId)
    .eq("run_date", today)
    .in("status", ["PARTIAL", "FAILED"])
    .is("continuation_enqueued", null) // Only unprocessed
    .order("created_at", { ascending: false })
    .limit(5);

  if (!partials || partials.length === 0) return results;

  for (const partial of partials) {
    // Fix A: Continue on BUDGET_EXHAUSTED regardless
    const needsContinuation =
      partial.failure_reason === "BUDGET_EXHAUSTED" ||
      (partial.items_skipped ?? 0) > 0 ||
      (partial.timeout_count ?? 0) > 0 ||
      partial.failure_reason === "ITEM_TIMEOUT";

    if (!needsContinuation) {
      // No continuation needed — record in telemetry
      await updateLedgerTelemetry(partial.id, false, "NO_PENDING_WORK");
      results.push({ continuation_enqueued: false, block_reason: "NO_PENDING_WORK", ledger_id: partial.id, warning_raised: false });
      continue;
    }

    // Check continuation count for today
    const { count: contCount } = await (supabase.from("auto_sync_daily_ledger") as any)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("run_date", today)
      .eq("is_continuation", true);

    if ((contCount ?? 0) >= MAX_CONTINUATIONS_PER_DAY) {
      await updateLedgerTelemetry(partial.id, false, "MAX_CONTINUATIONS_REACHED");
      await raiseWarning(orgId, partial, "MAX_CONTINUATIONS_REACHED");
      results.push({ continuation_enqueued: false, block_reason: "MAX_CONTINUATIONS_REACHED", ledger_id: partial.id, warning_raised: true });
      continue;
    }

    // Check cursor convergence (stuck cursor detection)
    if (partial.cursor_last_work_item_id) {
      const { data: prevRun } = await (supabase.from("auto_sync_daily_ledger") as any)
        .select("cursor_last_work_item_id, items_succeeded")
        .eq("organization_id", orgId)
        .eq("run_date", today)
        .eq("is_continuation", true)
        .lt("created_at", partial.created_at ?? new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (prevRun && prevRun.cursor_last_work_item_id === partial.cursor_last_work_item_id && (prevRun.items_succeeded ?? 0) === 0) {
        await updateLedgerTelemetry(partial.id, false, "CONVERGENCE_FAILED");
        await raiseWarning(orgId, partial, "CONVERGENCE_FAILED");
        results.push({ continuation_enqueued: false, block_reason: "CONVERGENCE_FAILED", ledger_id: partial.id, warning_raised: true });
        continue;
      }
    }

    // Enqueue continuation
    try {
      await supabase.functions.invoke("scheduled-daily-sync", {
        body: {
          org_id: orgId,
          resume_after_id: partial.cursor_last_work_item_id,
          is_continuation: true,
          continuation_of: partial.id,
        },
      });

      await updateLedgerTelemetry(partial.id, true, null);
      results.push({ continuation_enqueued: true, block_reason: null, ledger_id: partial.id, warning_raised: false });
    } catch {
      await updateLedgerTelemetry(partial.id, false, "UNKNOWN");
      await raiseWarning(orgId, partial, "UNKNOWN");
      results.push({ continuation_enqueued: false, block_reason: "UNKNOWN", ledger_id: partial.id, warning_raised: true });
    }
  }

  return results;
}

async function updateLedgerTelemetry(ledgerId: string, enqueued: boolean, blockReason: string | null): Promise<void> {
  await (supabase.from("auto_sync_daily_ledger") as any)
    .update({
      continuation_enqueued: enqueued,
      continuation_block_reason: blockReason,
    })
    .eq("id", ledgerId);
}

async function raiseWarning(orgId: string, partial: any, blockReason: string): Promise<void> {
  try {
    await (supabase.from("atenia_ai_actions") as any).insert({
      organization_id: orgId,
      action_type: "CONTINUATION_BLOCKED_WARNING",
      actor: "AI_AUTOPILOT",
      autonomy_tier: "OBSERVE",
      reasoning: `⚠️ Chain PARTIAL sin continuación: ${blockReason}. Chain ${partial.chain_id?.slice(0, 8) ?? partial.id.slice(0, 8)}, ${partial.items_succeeded ?? 0} OK, ${partial.items_skipped ?? 0} skipped, ${partial.timeout_count ?? 0} timeouts.`,
      action_result: "warning",
      status: "EXECUTED",
      evidence: {
        ledger_id: partial.id,
        chain_id: partial.chain_id,
        block_reason: blockReason,
        items_succeeded: partial.items_succeeded,
        items_skipped: partial.items_skipped,
        timeout_count: partial.timeout_count,
        expected_total: partial.expected_total_items,
      },
    });
  } catch { /* best-effort */ }
}
