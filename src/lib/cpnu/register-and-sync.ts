/**
 * register-and-sync.ts — Register a work item in Google Cloud SQL and trigger initial sync.
 * Handles both CPNU (CGP items) and PP (all items with radicado).
 * Fire-and-forget: logs errors but never throws.
 */

import { CPNU_API_BASE, PP_API_BASE } from "@/lib/api-urls";

export async function registerAndSyncCpnu(workItemId: string, radicado: string): Promise<boolean> {
  try {
    // 1. Register in Google Cloud SQL
    const regRes = await fetch(`${CPNU_API_BASE}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ work_item_id: workItemId, radicado }),
    });
    console.log(`[CPNU register] POST /work-items → ${regRes.status}`);

    // 2. Trigger initial sync
    const syncRes = await fetch(`${CPNU_API_BASE}/work-items/${workItemId}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    console.log(`[CPNU sync] POST /work-items/${workItemId}/sync → ${syncRes.status}`);

    return regRes.ok && syncRes.ok;
  } catch (err) {
    console.warn("[CPNU register-and-sync] Failed (non-blocking):", err);
    return false;
  }
}
