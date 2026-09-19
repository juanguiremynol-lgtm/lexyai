import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  callerOrganizationId,
  errorResult,
  requireWriteScope,
  sbForUser,
  textResult,
} from "../shared";

/**
 * Write side of the WhatsApp notice queue — everything EXCEPT approval.
 *
 * Hard invariants preserved here:
 *  - No message is sent. `approve` is not an action and never will be over MCP.
 *  - Consent is never inferred: recording one requires the phone number AND the
 *    lawyer's own words describing how the client authorised it.
 *  - Revoking stops future drafts, not just sends.
 *  - Draft bodies stay provider-reported facts; editing only rewrites the text
 *    the lawyer will read before approving it in the app.
 */
export default defineTool({
  name: "whatsapp_prepare",
  title: "Preparar avisos de WhatsApp (sin enviar)",
  description:
    "Records or revokes a client's WhatsApp consent, generates drafts from provider-reported facts, edits a draft's text, or discards one with a reason. It can NEVER approve or send a message — that always happens in the app, one message at a time.",
  inputSchema: {
    action: z
      .enum(["record_consent", "revoke_consent", "generate_drafts", "edit_draft", "discard_draft"])
      .describe("Qué hacer. No existe acción de aprobar ni de enviar."),
    client_id: z.string().uuid().optional().describe("Cliente (para record_consent)."),
    phone_e164: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{7,14}$/)
      .optional()
      .describe("Número con indicativo, solo dígitos, sin '+'. Ej: 573001234567."),
    consent_method: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .optional()
      .describe("Cómo autorizó el cliente, con las palabras del abogado. Obligatorio para record_consent."),
    consent_note: z.string().trim().max(1000).optional(),
    consent_id: z.string().uuid().optional().describe("Consentimiento a revocar."),
    revocation_reason: z.string().trim().max(500).optional(),
    lookback_days: z.number().int().min(1).max(30).optional().describe("Ventana de hechos para generate_drafts (default 7)."),
    draft_id: z.string().uuid().optional().describe("Borrador a editar o descartar."),
    body_text: z.string().trim().min(5).max(900).optional().describe("Texto corregido del borrador."),
    discard_reason: z.string().trim().min(3).max(500).optional().describe("Motivo del descarte (obligatorio)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (args, ctx) => {
    const denied = requireWriteScope(ctx);
    if (denied) return errorResult(denied);
    const sb = sbForUser(ctx);
    const userId = ctx.getUserId?.();
    if (!userId) return errorResult("No se pudo identificar al usuario del token.");
    const orgId = await callerOrganizationId(sb, userId);
    if (!orgId) return errorResult("No se encontró la organización del usuario.");

    if (args.action === "record_consent") {
      if (!args.client_id) return errorResult("Indica el cliente (client_id).");
      if (!args.phone_e164) return errorResult("Indica el número del cliente (solo dígitos, con indicativo, sin '+').");
      if (!args.consent_method) return errorResult("Escribe con tus palabras cómo autorizó el cliente el envío. El consentimiento nunca se deduce.");

      const { data, error } = await sb
        .from("client_wa_consent")
        .insert({
          organization_id: orgId,
          client_id: args.client_id,
          phone_e164: args.phone_e164,
          consent_method: args.consent_method,
          consent_note: args.consent_note ?? null,
          granted_by: userId,
          granted_at: new Date().toISOString(),
        })
        .select("id, client_id, phone_e164, consent_method, granted_at")
        .maybeSingle();
      if (error) return errorResult(error.message);
      return textResult("Consentimiento registrado. El número queda solo en este registro, nunca en la ficha del cliente.", {
        consentimiento: data,
      });
    }

    if (args.action === "revoke_consent") {
      if (!args.consent_id) return errorResult("Indica el consent_id a revocar.");
      const { data, error } = await sb
        .from("client_wa_consent")
        .update({
          revoked_at: new Date().toISOString(),
          revoked_by: userId,
          revocation_reason: args.revocation_reason ?? "Revocado por el abogado vía asistente IA",
        })
        .eq("id", args.consent_id)
        .is("revoked_at", null)
        .select("id, client_id, phone_e164, revoked_at")
        .maybeSingle();
      if (error) return errorResult(error.message);
      if (!data) return errorResult("Consentimiento no encontrado o ya revocado.");

      // Revocation stops drafts being created, not just sends.
      const { count } = await sb
        .from("client_wa_drafts")
        .update({ status: "DISCARDED", discard_reason: "Consentimiento revocado" }, { count: "exact" })
        .eq("consent_id", args.consent_id)
        .eq("status", "PENDING")
        .select("id");
      return textResult(`Consentimiento revocado; ${count ?? 0} borrador(es) pendiente(s) retirado(s).`, {
        consentimiento: data,
        borradores_retirados: count ?? 0,
      });
    }

    if (args.action === "generate_drafts") {
      const { data, error } = await sb.rpc("client_wa_generate_drafts", {
        _org: orgId,
        _lookback_days: args.lookback_days ?? 7,
      });
      if (error) return errorResult(error.message);
      return textResult(
        "Borradores preparados. Quedan en la cola para que los leas y apruebes uno por uno en la pantalla Avisos WhatsApp.",
        { resultado: data, nota: "Ningún mensaje se envía desde aquí." },
      );
    }

    if (args.action === "edit_draft") {
      if (!args.draft_id) return errorResult("Indica el draft_id.");
      if (!args.body_text) return errorResult("Indica el texto corregido (body_text).");
      const { data, error } = await sb
        .from("client_wa_drafts")
        .update({ edited_body_text: args.body_text })
        .eq("id", args.draft_id)
        .eq("status", "PENDING")
        .select("id, client_id, work_item_id, body_text, edited_body_text, status, expires_at")
        .maybeSingle();
      if (error) return errorResult(error.message);
      if (!data) return errorResult("Borrador no encontrado o ya no está pendiente.");
      return textResult("Texto del borrador actualizado; sigue pendiente de tu aprobación en la app.", { borrador: data });
    }

    if (!args.draft_id) return errorResult("Indica el draft_id.");
    if (!args.discard_reason) return errorResult("El descarte exige un motivo.");
    const { data, error } = await sb
      .from("client_wa_drafts")
      .update({ status: "DISCARDED", discard_reason: args.discard_reason })
      .eq("id", args.draft_id)
      .eq("status", "PENDING")
      .select("id, status, discard_reason")
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Borrador no encontrado o ya no está pendiente.");
    return textResult("Borrador descartado.", { borrador: data });
  },
});
