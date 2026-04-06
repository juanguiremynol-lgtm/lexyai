/**
 * register-and-sync.ts — Register a work item in Google Cloud SQL and trigger initial sync.
 * Handles both CPNU (CGP items) and PP (all items with radicado).
 * Fire-and-forget: logs errors but never throws.
 */

import { CPNU_API_BASE, PP_API_BASE } from "@/lib/api-urls";
import { supabase } from "@/integrations/supabase/client";

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

/** Register a work item in PP (Portal Publicaciones) Google Cloud SQL and trigger initial sync.
 *  Captures the numeric pp_id from the response and stores it in Supabase. */
export async function registerAndSyncPp(workItemId: string, radicado: string): Promise<boolean> {
  try {
    const regRes = await fetch(`${PP_API_BASE}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ radicado }),
    });
    console.log(`[PP register] POST /work-items → ${regRes.status}`);

    let ppId: number | null = null;

    if (regRes.ok) {
      const regBody = await regRes.json();
      ppId = regBody?.item?.id ?? null;
      console.log(`[PP register] pp_id=${ppId}`);

      // Store numeric PP ID in Supabase
      if (ppId != null) {
        const { error } = await supabase
          .from("work_items")
          .update({ pp_id: ppId } as any)
          .eq("id", workItemId);
        if (error) console.warn("[PP register] Failed to save pp_id:", error);
      }
    }

    // Trigger sync using the numeric PP ID
    if (ppId != null) {
      const syncRes = await fetch(`${PP_API_BASE}/work-items/${ppId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      console.log(`[PP sync] POST /work-items/${ppId}/sync → ${syncRes.status}`);
      return syncRes.ok;
    }

    return false;
  } catch (err) {
    console.warn("[PP register-and-sync] Failed (non-blocking):", err);
    return false;
  }
}
