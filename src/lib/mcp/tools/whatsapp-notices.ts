import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { errorResult, requireAuth, sbForUser, textResult } from "../shared";

/**
 * Read side of the client WhatsApp notice queue.
 *
 * Approval and sending are deliberately absent from MCP: no message ever
 * leaves Andromeda without the lawyer pressing approve on the draft he read,
 * in the app. An assistant may prepare, inspect and discard — never send.
 */
export default defineTool({
  name: "whatsapp_notices",
  title: "Avisos de WhatsApp a clientes",
  description:
    "Shows the client WhatsApp notice pipeline: recorded consents, drafts awaiting the lawyer's approval, and the audit log of messages already sent. Read-only. Approval and sending happen only in the app — never over MCP.",
  inputSchema: {
    view: z.enum(["all", "consents", "drafts", "sends"]).optional().describe("Qué mostrar (default all)."),
    draft_status: z.enum(["PENDING", "APPROVED", "SENT", "DISCARDED", "EXPIRED", "FAILED", "ALL"]).optional(),
    limit: z.number().int().min(1).max(100).optional().describe("Máximo por sección (default 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ view, draft_status, limit }, ctx) => {
    const unauth = requireAuth(ctx);
    if (unauth) return errorResult(unauth);
    const sb = sbForUser(ctx);
    const cap = limit ?? 30;
    const want = view ?? "all";

    const payload: Record<string, unknown> = {};

    if (want === "all" || want === "consents") {
      const { data, error } = await sb
        .from("client_wa_consent")
        .select("id, client_id, phone_e164, consent_method, consent_note, granted_at, revoked_at, revocation_reason")
        .order("granted_at", { ascending: false })
        .limit(cap);
      if (error) return errorResult(error.message);
      payload.consentimientos = data ?? [];
    }

    if (want === "all" || want === "drafts") {
      let q = sb
        .from("client_wa_drafts")
        .select("id, client_id, work_item_id, source_kind, fact_date, fact_text, body_text, edited_body_text, status, discard_reason, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(cap);
      const st = draft_status ?? "PENDING";
      if (st !== "ALL") q = q.eq("status", st);
      const { data, error } = await q;
      if (error) return errorResult(error.message);
      payload.borradores = data ?? [];
    }

    if (want === "all" || want === "sends") {
      const { data, error } = await sb
        .from("client_wa_sends")
        .select("id, client_id, work_item_id, phone_e164, template_name, body_text, approved_by, approved_at, sent_at, delivery_status, error_text")
        .order("sent_at", { ascending: false })
        .limit(cap);
      if (error) return errorResult(error.message);
      payload.enviados = data ?? [];
    }

    const nDrafts = (payload.borradores as unknown[] | undefined)?.length ?? 0;
    const nConsents = (payload.consentimientos as unknown[] | undefined)?.length ?? 0;
    const nSends = (payload.enviados as unknown[] | undefined)?.length ?? 0;

    return textResult(
      `Avisos WhatsApp — ${nConsents} consentimiento(s), ${nDrafts} borrador(es), ${nSends} envío(s).`,
      {
        ...payload,
        nota: "La aprobación y el envío se hacen únicamente en la pantalla Avisos WhatsApp de Andromeda: ninguna herramienta envía mensajes a clientes.",
      },
    );
  },
});
