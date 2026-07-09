/**
 * Work Item Soft Delete Service
 * 
 * Handles soft deletion of work items. Sets deleted_at + purge_after (10 days),
 * disables monitoring, cancels pending scrape jobs, logs to audit trail,
 * and creates a recovery log entry for Atenia AI.
 *
 * AUTHORIZATION (enforced before any writes):
 *   MEMBER: only own items (owner_id = userId)
 *   ORG ADMIN (BUSINESS): any item in their org
 *   SUPER ADMIN: only via support_access_grants (not handled here)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { checkWorkItemRetention } from "./document-retention-service";
import { setWorkItemLifecycle } from "@/lib/lifecycle";

export interface SoftDeleteResult {
  success: boolean;
  error?: string;
}

// ─── Authorization helper ───────────────────────────────────
async function canActOnWorkItem(
  supabase: SupabaseClient,
  userId: string,
  workItem: { owner_id?: string; organization_id?: string | null }
): Promise<boolean> {
  // Owner can always act on their own items
  if (workItem.owner_id === userId) return true;

  // Check if user is org admin on a BUSINESS tier
  if (workItem.organization_id) {
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("organization_id", workItem.organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (membership && (membership.role === "OWNER" || membership.role === "ADMIN")) {
      const { data: billing } = await supabase
        .from("billing_subscription_state")
        .select("plan_code")
        .eq("organization_id", workItem.organization_id)
        .maybeSingle();

      if (billing && ["BUSINESS", "ENTERPRISE"].includes(billing.plan_code ?? "")) {
        return true;
      }
    }
  }

  return false;
}

export async function softDeleteWorkItem(
  supabase: SupabaseClient,
  workItemId: string,
  userId: string,
  reason?: string,
  forceOverrideRetention?: boolean
): Promise<SoftDeleteResult> {
  // 1. Load work item (verify it exists and isn't already deleted)
  const { data: item, error: loadError } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, authority_name, organization_id, owner_id, deleted_at, monitoring_enabled, stage")
    .eq("id", workItemId)
    .single();

  if (loadError || !item) return { success: false, error: "Asunto no encontrado" };
  if (item.deleted_at) return { success: false, error: "Este asunto ya fue eliminado" };

  // 2. AUTHORIZATION CHECK — before any writes
  const authorized = await canActOnWorkItem(supabase, userId, item);
  if (!authorized) {
    return { success: false, error: "No tienes permiso para eliminar este asunto" };
  }

  // 2b. RETENTION CHECK — block deletion if finalized docs are within retention
  if (!forceOverrideRetention) {
    const retentionCheck = await checkWorkItemRetention(supabase, workItemId);
    if (!retentionCheck.canDelete) {
      return {
        success: false,
        error: retentionCheck.reason || "Documentos dentro del periodo de retención legal impiden la eliminación.",
      };
    }
  }

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // +10 days

  // 3. Route through the canonical RPC. This atomically:
  //    - sets lifecycle_state='DELETED' + deleted_at + purge_after (+10 days)
  //    - flips monitoring_enabled/scraping_enabled to false
  //    - cancels PENDING scrape jobs
  //    - writes an audit_logs row
  //    - enqueues a gcp_lifecycle_outbox row (GCP scraper notification)
  const lifecycle = await setWorkItemLifecycle(supabase, {
    workItemId,
    newState: "DELETED",
    reason: reason ?? "USER_SOFT_DELETE",
    actor: "USER",
    actorUserId: userId,
    metadata: { workflow_type: item.workflow_type },
  });
  if (!lifecycle.ok) {
    return {
      success: false,
      error: lifecycle.error || "No se pudo eliminar el asunto.",
    };
  }

  // 4. Create soft delete log entry (denormalized snapshot for Atenia AI recovery)
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

  // 5. Log to Atenia AI action ledger (recovery UX prompt)
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
      authorization: {
        is_owner: item.owner_id === userId,
      },
    },
  });

  // 6. GCP scraper notification is delivered by gcp-lifecycle-broadcaster
  //    consuming the gcp_lifecycle_outbox row inserted by the RPC.
  return { success: true };
}
