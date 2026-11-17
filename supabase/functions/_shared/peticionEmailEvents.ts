/**
 * Persists administrative (PETICION / GOV_PROCEDURE) email links and their
 * review events. Shared by outlook-sync (automatic) and outlook-message-link
 * (manual, selective backfill). Metadata only: bodies are never stored.
 *
 * Judicial email effects must not fire for administrative matters, so the
 * link carries evidence_type 'OTRO' and evidence_subtype NULL; the
 * administrative class lives in evidence_meta.admin_class.
 */
import type { GraphMessage } from "./emailMatcher.ts";
import {
  bogotaDate,
  classifyAdministrativeEmail,
  eventCodeFor,
  extractProposedOfficialId,
  type AdminLinkDecision,
} from "./peticionEmailLinking.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface AdminLinkInput {
  userId: string;
  connectionId: string | null;
  msg: GraphMessage;
  direction: "sent" | "received";
  decision: AdminLinkDecision | {
    work_item_id: string; organization_id: string | null; link_status: "CONFIRMED";
    matched_by: "MANUAL"; matched_value: string; confidence: number;
  };
  provenance: Record<string, unknown>;
}

export function buildAdminLinkRow(input: AdminLinkInput) {
  const { msg, direction, decision } = input;
  const cls = classifyAdministrativeEmail(msg, direction);
  return {
    user_id: input.userId,
    organization_id: decision.organization_id,
    work_item_id: decision.work_item_id,
    connection_id: input.connectionId,
    message_id: msg.id,
    internet_message_id: msg.internetMessageId ?? null,
    conversation_id: msg.conversationId ?? null,
    direction,
    subject: msg.subject ?? null,
    sender: msg.from?.emailAddress?.address ?? msg.sender?.emailAddress?.address ?? null,
    recipients: (msg.toRecipients ?? []).map((r) => r.emailAddress?.address)
      .filter((a): a is string => Boolean(a)).slice(0, 10),
    received_at: msg.receivedDateTime ?? msg.sentDateTime ?? null,
    has_attachments: Boolean(msg.hasAttachments),
    web_link: msg.webLink ?? null,
    matched_by: decision.matched_by,
    matched_value: decision.matched_value,
    confidence: decision.confidence,
    evidence_type: "OTRO",
    evidence_subtype: null,
    memorial_subtype: null,
    low_content: false,
    // Excludes the row from the judicial semantics backfill (cron job 80 and
    // email-semantics-backfill both require ai_classified_at IS NULL): a
    // judicial subtype on an administrative link would create court deadlines.
    ai_classified: false,
    ai_classified_at: new Date().toISOString(),
    evidence_meta: {
      admin_class: cls,
      proposed_official_id: direction === "received" ? extractProposedOfficialId(msg) : null,
      provenance: input.provenance,
      legal_anchor: false,
    },
    link_status: decision.link_status,
  };
}

/** Idempotent: one event per work item + internet message (or Graph id). */
export async function recordAdminEmailEvent(
  admin: Admin,
  row: ReturnType<typeof buildAdminLinkRow>,
  linkId: string | null,
  actorUserId: string | null,
): Promise<"created" | "exists" | "skipped"> {
  if (row.link_status !== "CONFIRMED") return "skipped";
  const { data: wi, error: wiErr } = await admin.from("work_items")
    .select("id, owner_id, organization_id, workflow_type").eq("id", row.work_item_id).maybeSingle();
  if (wiErr) throw new Error(`work_items: ${wiErr.message}`);
  if (!wi || wi.workflow_type !== "PETICION") return "skipped";
  const key = row.internet_message_id ?? row.message_id;
  const { data: existing, error: exErr } = await admin.from("peticion_events").select("id")
    .eq("work_item_id", row.work_item_id).eq("source", "EMAIL_EVIDENCE")
    .contains("metadata", { message_key: key }).limit(1);
  if (exErr) throw new Error(`peticion_events read: ${exErr.message}`);
  if ((existing ?? []).length > 0) return "exists";
  const cls = row.evidence_meta.admin_class;
  const { error } = await admin.from("peticion_events").insert({
    work_item_id: row.work_item_id,
    organization_id: wi.organization_id,
    owner_id: wi.owner_id,
    event_code: eventCodeFor(cls),
    event_date: bogotaDate(row.received_at),
    source: "EMAIL_EVIDENCE",
    legal_effect: null,
    notes: cls === "ENVIO"
      ? "Envío observado en Elementos enviados: soporte de presentación. La recepción por la entidad no queda acreditada por este registro."
      : "Novedad recibida por correo; requiere revisión humana antes de registrar efectos.",
    metadata: {
      message_key: key,
      link_id: linkId,
      admin_class: cls,
      direction: row.direction,
      subject: row.subject,
      proposed_official_id: row.evidence_meta.proposed_official_id,
      requires_human_review: row.direction === "received",
      legal_anchor: false,
    },
    created_by: actorUserId,
  });
  if (error) throw new Error(`peticion_events: ${error.message}`);
  return "created";
}
