/**
 * Send one approved client notice over WhatsApp Business.
 *
 * Invariants:
 *  - Sends exactly one draft, and only when that draft is already APPROVED by a user.
 *  - Never drafts, never approves, never bulk-sends.
 *  - Writes an immutable row in client_wa_sends (the lawyer's evidence of what was told).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/whatsapp";
const TEMPLATE_NAME = Deno.env.get("WHATSAPP_CLIENT_TEMPLATE") ?? "andromeda_aviso_proceso";
const TEMPLATE_LANG = "es";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const draftId = typeof body?.draft_id === "string" ? body.draft_id : null;
    if (!draftId) return json({ error: "draft_id is required" }, 400);

    // AUDIT FINDING 8 — ATOMIC CLAIM. Reading an APPROVED draft and then
    // sending leaves a window in which two callers both send the same notice to
    // the client. The claim is a single UPDATE (APPROVED -> SENDING) executed
    // through the caller's session, so RLS/membership, consent validity, the
    // approval record and the expiry are all checked inside one statement.
    const { data: claimedRow, error: claimErr } = await asUser.rpc("client_wa_claim_draft", {
      _draft: draftId,
    });
    if (claimErr) return json({ error: claimErr.message }, 400);
    const draft = (Array.isArray(claimedRow) ? claimedRow[0] : claimedRow) as
      | Record<string, unknown>
      | null;
    if (!draft || !draft.id) {
      // Either the draft is gone, not approved, expired, consent revoked, or
      // another caller already claimed it. All of them mean: do not send.
      const { data: current } = await asUser
        .from("client_wa_drafts")
        .select("status, expires_at")
        .eq("id", draftId)
        .maybeSingle();
      return json(
        {
          error: "draft_not_claimable",
          status: current?.status ?? "UNKNOWN",
          message:
            "El aviso no está aprobado y vigente, o ya fue tomado para envío. No se envió nada.",
        },
        409,
      );
    }

    const admin = createClient(url, service);

    const { data: consent } = await admin
      .from("client_wa_consent")
      .select("id, phone_e164, revoked_at")
      .eq("id", draft.consent_id as string)
      .maybeSingle();
    if (!consent || consent.revoked_at) {
      await admin.from("client_wa_drafts").update({ status: "APPROVED" }).eq("id", draft.id as string);
      return json({ error: "consent revoked or missing" }, 409);
    }


    /** Give the claim back so the lawyer can retry after fixing the cause. */
    const releaseClaim = async () => {
      await admin.from("client_wa_drafts").update({ status: "APPROVED" }).eq("id", draft.id as string);
    };

    const { data: item } = await admin
      .from("work_items")
      .select("title, radicado")
      .eq("id", draft.work_item_id as string)
      .maybeSingle();
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", draft.organization_id as string)
      .maybeSingle();

    const text = ((draft.edited_body_text ?? draft.body_text) ?? "") as string;
    const caratula = item?.title || item?.radicado || "su proceso";
    const firm = org?.name || "su abogado";

    // {{4}} — contacto real del abogado que aprueba. Sin teléfono y correo no se envía:
    // un aviso que dice "llame a su abogado" sin el número genera una llamada perdida.
    const { data: approver } = await admin
      .from("profiles")
      .select("phone, litigation_email, email")
      .eq("id", draft.approved_by as string)
      .maybeSingle();
    const lawyerPhone = (approver?.phone ?? "").trim();
    const lawyerEmail = (approver?.litigation_email ?? approver?.email ?? "").trim();
    if (!lawyerPhone || !lawyerEmail) {
      await releaseClaim();
      return json(
        {
          error: "contacto_incompleto",
          message:
            "Falta su teléfono o su correo en el perfil. El aviso no se envió porque el cliente quedaría sin a quién llamar.",
        },
        412,
      );
    }
    const contacto = `${lawyerPhone} · ${lawyerEmail}`;


    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const WHATSAPP_API_KEY = Deno.env.get("WHATSAPP_API_KEY");
    if (!LOVABLE_API_KEY || !WHATSAPP_API_KEY) {
      await releaseClaim();
      return json(
        {
          error: "whatsapp_not_connected",
          message:
            "No hay una conexión de WhatsApp Business vinculada a este proyecto. El aviso no se envió.",
        },
        412,
      );
    }


    const payload = {
      messaging_product: "whatsapp",
      to: consent.phone_e164,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: firm },
              { type: "text", text: caratula },
              { type: "text", text: text },
              { type: "text", text: contacto },
            ],
          },
        ],
      },
    };

    const res = await fetch(`${GATEWAY_URL}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": WHATSAPP_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    if (!res.ok) {
      console.error(`WhatsApp send failed [${res.status}]: ${raw}`);
      await admin.from("client_wa_drafts").update({ status: "FAILED" }).eq("id", draft.id as string);
      await admin.from("client_wa_sends").insert({
        organization_id: draft.organization_id,
        draft_id: draft.id,
        client_id: draft.client_id,
        work_item_id: draft.work_item_id,
        phone_e164: consent.phone_e164,
        template_name: TEMPLATE_NAME,
        body_text: text,
        approved_by: draft.approved_by,
        approved_at: draft.approved_at,
        delivery_status: "FAILED",
        provider_response: parsed as Record<string, unknown>,
        error_text: raw.slice(0, 2000),
      });
      return json({ error: "provider_request_failed", status: res.status, details: raw }, res.status);
    }

    const waId =
      (parsed as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null;

    // The provider already accepted the message: the evidence row and the state
    // change MUST be checked, not fired and forgotten. A silent failure here is
    // a notice the client received and the lawyer's record denies.
    const { error: evidenceErr } = await admin.from("client_wa_sends").insert({
      organization_id: draft.organization_id,
      draft_id: draft.id,
      client_id: draft.client_id,
      work_item_id: draft.work_item_id,
      phone_e164: consent.phone_e164,
      template_name: TEMPLATE_NAME,
      body_text: text,
      approved_by: draft.approved_by,
      approved_at: draft.approved_at,
      wa_message_id: waId,
      delivery_status: "ACCEPTED",
      provider_response: parsed as Record<string, unknown>,
    });
    const { error: stateErr } = await admin
      .from("client_wa_drafts")
      .update({ status: "SENT" })
      .eq("id", draft.id as string);

    if (evidenceErr || stateErr) {
      console.error(
        "[whatsapp-send-client-notice] message SENT but persistence failed",
        evidenceErr?.message,
        stateErr?.message,
      );
      return json(
        {
          ok: true,
          wa_message_id: waId,
          warning: "persistencia_incompleta",
          message:
            "El aviso salió al cliente, pero el registro interno quedó incompleto. No lo reenvíe.",
          details: [evidenceErr?.message, stateErr?.message].filter(Boolean),
        },
        207,
      );
    }

    return json({ ok: true, wa_message_id: waId });
  } catch (e) {

    console.error("whatsapp-send-client-notice error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
