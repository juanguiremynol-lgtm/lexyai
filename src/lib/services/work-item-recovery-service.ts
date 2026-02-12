/**
 * Work Item Recovery Service
 * 
 * Handles recovery of soft-deleted work items within the 10-day window.
 * Used by Atenia AI to restore items on user request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RecoveryResult {
  success: boolean;
  error?: string;
  recoveredItem?: { id: string; radicado: string };
}

export async function recoverSoftDeletedWorkItem(
  supabase: SupabaseClient,
  options: {
    workItemId?: string;
    radicado?: string;
    organizationId: string;
    requestedByUserId: string;
  }
): Promise<RecoveryResult> {
  // 1. Find the soft-deleted item
  let query = supabase
    .from("work_items")
    .select("id, radicado, organization_id, deleted_at, purge_after, deleted_by, workflow_type, stage");

  if (options.workItemId) {
    query = query.eq("id", options.workItemId);
  } else if (options.radicado) {
    query = query.eq("radicado", options.radicado);
  } else {
    return { success: false, error: "Se requiere el ID o radicado del asunto" };
  }

  query = query
    .eq("organization_id", options.organizationId)
    .not("deleted_at", "is", null);

  const { data: item, error: findError } = await query.single();

  if (findError || !item) {
    return {
      success: false,
      error: "No se encontró un asunto eliminado con ese identificador en tu organización.",
    };
  }

  // 2. Check if within recovery window
  if (item.purge_after && new Date(item.purge_after) < new Date()) {
    return {
      success: false,
      error: `El asunto ${item.radicado} fue eliminado hace más de 10 días y ya no puede recuperarse.`,
    };
  }

  // 3. Restore the work item
  const { error: restoreError } = await supabase
    .from("work_items")
    .update({
      deleted_at: null,
      deleted_by: null,
      purge_after: null,
      delete_reason: null,
      // Do NOT re-enable monitoring — user should decide
    })
    .eq("id", item.id);

  if (restoreError) {
    return { success: false, error: `Error al restaurar: ${restoreError.message}` };
  }

  // 4. Update soft delete log
  const actionId = crypto.randomUUID();

  await supabase
    .from("work_item_soft_deletes")
    .update({
      status: "RESTORED",
      restored_at: new Date().toISOString(),
      restored_by_action_id: actionId,
    })
    .eq("work_item_id", item.id)
    .eq("status", "DELETED");

  // 5. Log recovery action
  await supabase.from("atenia_ai_actions").insert({
    id: actionId,
    action_type: "RESTORE_SOFT_DELETED_WORK_ITEM",
    actor: "AI_AUTOPILOT",
    actor_user_id: options.requestedByUserId,
    scope: "ORG",
    autonomy_tier: "CONFIRMED",
    organization_id: item.organization_id,
    work_item_id: item.id,
    reasoning: `Asunto ${item.radicado} restaurado a solicitud del usuario. El monitoreo permanece desactivado.`,
    status: "EXECUTED",
    is_reversible: true,
    evidence: {
      radicado: item.radicado,
      workflow_type: item.workflow_type,
      was_deleted_at: item.deleted_at,
      was_purge_after: item.purge_after,
      deleted_by: item.deleted_by,
      restored_by: options.requestedByUserId,
    },
  });

  return {
    success: true,
    recoveredItem: { id: item.id, radicado: item.radicado ?? "Sin radicado" },
  };
}

// ============= Recovery Intent Detection =============

const RECOVERY_PATTERNS = [
  /recuperar.*(?:radicado|asunto|caso)/i,
  /restaurar.*(?:radicado|asunto|caso)/i,
  /deshacer.*(?:elimina|borra)/i,
  /(?:radicado|asunto|caso).*(?:eliminé|borré|eliminado|borrado)/i,
  /(?:quiero|necesito|puedo).*(?:recuperar|restaurar|volver)/i,
  /(?:papelera|eliminad)/i,
];

const LIST_DELETED_PATTERNS = [
  /(?:qué|cuáles).*(?:eliminé|borré|eliminado|borrado)/i,
  /(?:papelera|eliminados|borrados)/i,
  /(?:lista|ver|mostrar).*(?:eliminad|borrad)/i,
];

export function detectRecoveryIntent(messageText: string): boolean {
  return RECOVERY_PATTERNS.some((p) => p.test(messageText));
}

export function detectListDeletedIntent(messageText: string): boolean {
  return LIST_DELETED_PATTERNS.some((p) => p.test(messageText));
}

export function extractRadicado(messageText: string): string | null {
  const match = messageText.match(/\b(\d{23})\b/);
  return match ? match[1] : null;
}

export async function listDeletedItems(
  supabase: SupabaseClient,
  orgId: string
): Promise<string> {
  const { data: items } = await supabase
    .from("work_item_soft_deletes")
    .select("radicado, workflow_type, despacho, deleted_at, purge_after, delete_reason")
    .eq("organization_id", orgId)
    .eq("status", "DELETED")
    .order("deleted_at", { ascending: false })
    .limit(20);

  if (!items || items.length === 0) {
    return "No hay asuntos eliminados pendientes de purga en tu organización.";
  }

  let response = `📋 **Asuntos en papelera** (${items.length}):\n\n`;
  for (const item of items) {
    const daysLeft = Math.ceil(
      (new Date(item.purge_after).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    response += `• **${item.radicado}** (${item.workflow_type})\n`;
    response += `  Eliminado: ${new Date(item.deleted_at).toLocaleDateString("es-CO")}`;
    response += ` · ${daysLeft > 0 ? `${daysLeft} días restantes` : "⚠️ Purga inminente"}\n`;
    if (item.delete_reason) response += `  Razón: ${item.delete_reason}\n`;
    response += "\n";
  }
  response += `Para recuperar un asunto, dime el radicado y lo restauro.`;

  return response;
}
