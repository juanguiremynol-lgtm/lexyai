/**
 * Server-side authorization for outlook-message-link. RLS read visibility is
 * never enough: linking writes with service_role, so it requires the matter
 * owner, an ACTIVE lifecycle, no soft-delete, an administrative workflow and
 * the caller's own CONNECTED Outlook mailbox.
 */
import { ADMIN_WORKFLOWS } from "../_shared/peticionEmailLinking.ts";

export interface WorkItemAuthRow {
  id: string;
  owner_id: string | null;
  workflow_type: string | null;
  lifecycle_state: string | null;
  deleted_at: string | null;
}

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

export function authorizeAdminMailAction(
  wi: WorkItemAuthRow | null,
  callerId: string,
  action: "search" | "link",
  mailbox: { user_id: string } | null,
): AuthDecision {
  if (!wi) return { ok: false, status: 404, error: "Asunto no encontrado" };
  if (!ADMIN_WORKFLOWS.has(String(wi.workflow_type))) {
    return { ok: false, status: 400, error: "Solo aplica a peticiones y trámites administrativos" };
  }
  if (wi.deleted_at || wi.lifecycle_state !== "ACTIVE") {
    return { ok: false, status: 403, error: "El asunto no está activo" };
  }
  // Both actions are owner-only: search also reveals link status of the matter
  // and is only useful as a prelude to linking (ROLE_AND_SUBSCRIPTION_SPEC §5).
  if (!wi.owner_id || wi.owner_id !== callerId) {
    return { ok: false, status: 403, error: "No tienes permiso para gestionar este asunto" };
  }
  if (!mailbox || mailbox.user_id !== callerId) {
    return { ok: false, status: 403, error: "No tienes un buzón de Outlook conectado." };
  }
  void action;
  return { ok: true };
}
