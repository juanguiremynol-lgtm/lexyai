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

    // Read through the caller's session so RLS proves org membership.
    const { data: draft, error: draftErr } = await asUser
      .from("client_wa_drafts")
      .select("*")
      .eq("id", draftId)
      .maybeSingle();
    if (draftErr) return json({ error: draftErr.message }, 400);
    if (!draft) return json({ error: "draft not found" }, 404);

    if (draft.status !== "APPROVED") {
      return json({ error: "draft is not approved", status: draft.status }, 409);
    }
    if (!draft.approved_by || !draft.approved_at) {
      return json({ error: "draft has no approval record" }, 409);
    }
    if (new Date(draft.expires_at).getTime() < Date.now()) {
      return json({ error: "draft expired", expires_at: draft.expires_at }, 409);
    }

    const admin = createClient(url, service);

    const { data: consent } = await admin
      .from("client_wa_consent")
      .select("id, phone_e164, revoked_at")
      .eq("id", draft.consent_id)
      .maybeSingle();
    if (!consent || consent.revoked_at) {
      return json({ error: "consent revoked or missing" }, 409);
    }

    const { data: item } = await admin
      .from("work_items")
      .select("title, radicado")
      .eq("id", draft.work_item_id)
      .maybeSingle();
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", draft.organization_id)
      .maybeSingle();

    const text = (draft.edited_body_text ?? draft.body_text) as string;
    const caratula = item?.title || item?.radicado || "su proceso";
    const firm = org?.name || "su abogado";

    // {{4}} — contacto real del abogado que aprueba. Sin teléfono y correo no se envía:
    // un aviso que dice "llame a su abogado" sin el número genera una llamada perdida.
    const { data: approver } = await admin
      .from("profiles")
      .select("phone, litigation_email, email")
      .eq("id", draft.approved_by)
      .maybeSingle();
    const lawyerPhone = (approver?.phone ?? "").trim();
    const lawyerEmail = (approver?.litigation_email ?? approver?.email ?? "").trim();
    if (!lawyerPhone || !lawyerEmail) {
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
      await admin.from("client_wa_drafts").update({ status: "FAILED" }).eq("id", draft.id);
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
      wa_message_id: waId,
      delivery_status: "ACCEPTED",
      provider_response: parsed as Record<string, unknown>,
    });
    await admin.from("client_wa_drafts").update({ status: "SENT" }).eq("id", draft.id);

    return json({ ok: true, wa_message_id: waId });
  } catch (e) {
    console.error("whatsapp-send-client-notice error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
