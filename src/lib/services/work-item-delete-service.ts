/**
 * Work Item Soft Delete Service
 * 
 * Handles soft deletion of work items. Sets deleted_at + purge_after (10 days),
 * disables monitoring, cancels pending scrape jobs, logs to audit trail,
 * and creates a recovery log entry for Atenia AI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SoftDeleteResult {
  success: boolean;
  error?: string;
}

export async function softDeleteWorkItem(
  supabase: SupabaseClient,
  workItemId: string,
  userId: string,
  reason?: string
): Promise<SoftDeleteResult> {
  // 1. Load work item (verify it exists and isn't already deleted)
  const { data: item, error: loadError } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, authority_name, organization_id, deleted_at, monitoring_enabled, stage")
    .eq("id", workItemId)
    .single();

  if (loadError || !item) return { success: false, error: "Asunto no encontrado" };
  if (item.deleted_at) return { success: false, error: "Este asunto ya fue eliminado" };

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // +10 days

  // 2. Set soft delete fields on work_items
  const { error: updateError } = await supabase
    .from("work_items")
    .update({
      deleted_at: now.toISOString(),
      deleted_by: userId,
      purge_after: purgeAfter.toISOString(),
      delete_reason: reason ?? null,
      monitoring_enabled: false,
    })
    .eq("id", workItemId);

  if (updateError) return { success: false, error: updateError.message };

  // 3. Create soft delete log entry (denormalized snapshot for Atenia AI recovery)
  await supabase.from("work_item_soft_deletes").insert({
    work_item_id: workItemId,
    organization_id: item.organization_id,
    deleted_by_user_id: userId,
    deleted_at: now.toISOString(),
    purge_after: purgeAfter.toISOString(),
    delete_reason: reason ?? null,
    radicado: item.radicado ?? "Sin radicado",
    workflow_type: item.workflow_type,
    despacho: item.authority_name,
    item_snapshot: {
      stage: item.stage,
      monitoring_was_enabled: item.monitoring_enabled,
      workflow_type: item.workflow_type,
    },
  });

  // 4. Cancel any pending scraping jobs
  await supabase
    .from("work_item_scrape_jobs")
    .update({ status: "CANCELLED" })
    .eq("work_item_id", workItemId)
    .eq("status", "PENDING");

  // 5. Log to Atenia AI action ledger
  const purgeDate = purgeAfter.toLocaleDateString("es-CO");
  await supabase.from("atenia_ai_actions").insert({
    action_type: "SOFT_DELETE_WORK_ITEM",
    actor: "USER",
    actor_user_id: userId,
    scope: "ORG",
    autonomy_tier: "MANUAL",
    organization_id: item.organization_id,
    work_item_id: workItemId,
    reasoning: reason
      ? `Usuario eliminó el asunto ${item.radicado}. Razón: ${reason}. Recuperable hasta ${purgeDate}.`
      : `Usuario eliminó el asunto ${item.radicado}. Recuperable hasta ${purgeDate}.`,
    status: "EXECUTED",
    is_reversible: true,
    evidence: {
      radicado: item.radicado,
      workflow_type: item.workflow_type,
      purge_after: purgeAfter.toISOString(),
    },
  });

  return { success: true };
}
