/**
 * bridge-verification.ts — iteration 20.
 *
 * A local sync that never produced rows is not evidence that the matter is
 * empty upstream. Before any automatic path pauses or de-monitors a work item,
 * it must ask the provider through `bridge-reconcile`, which compares the
 * provider inventory against what actually landed in our tables.
 *
 * Contract:
 *   - `hasProviderRows === true`  → do NOT pause. This is a bridge defect.
 *   - `providerAnswered === false` → do NOT pause. Nothing can be concluded.
 *   - both false                   → the provider genuinely has no rows.
 */

import { supabase } from "@/integrations/supabase/client";

export interface BridgeVerification {
  hasProviderRows: boolean;
  providerAnswered: boolean;
  providerRowCount: number;
  recoveredRows: number;
}

export async function verifyWithProvider(workItemId: string): Promise<BridgeVerification> {
  const fallback: BridgeVerification = {
    hasProviderRows: false,
    providerAnswered: false,
    providerRowCount: 0,
    recoveredRows: 0,
  };

  const { data, error } = await supabase.functions.invoke("bridge-reconcile", {
    body: { work_item_ids: [workItemId], heal: true, force_refresh: true },
  });
  if (error || !data?.ok) return fallback;

  const lines = (data.lines ?? []) as Array<{ provider_count: number; transfer_state: string }>;
  const providerRowCount = lines.reduce((n, l) => n + (l.provider_count ?? 0), 0);

  return {
    hasProviderRows: providerRowCount > 0,
    providerAnswered: lines.some((l) => l.transfer_state !== "PROVIDER_UNAVAILABLE"),
    providerRowCount,
    recoveredRows: Number(data.recovered_rows ?? 0),
  };
}

/**
 * True when an automatic path is allowed to pause / de-monitor the item.
 */
export async function mayAutoSuspendMonitoring(workItemId: string): Promise<{ allowed: boolean; reason: string }> {
  const v = await verifyWithProvider(workItemId);
  if (v.hasProviderRows) {
    return { allowed: false, reason: "PROVIDER_HAS_ROWS_BRIDGE_DEFECT" };
  }
  if (!v.providerAnswered) {
    return { allowed: false, reason: "PROVIDER_UNAVAILABLE_INCONCLUSIVE" };
  }
  return { allowed: true, reason: "PROVIDER_CONFIRMED_NO_ROWS" };
}
