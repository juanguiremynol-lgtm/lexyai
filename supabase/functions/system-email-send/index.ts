/**
 * system-email-send — Sends email via Resend for Platform Compose.
 * Super Admin only. Logs to system_email_messages.
 * Returns structured errors for the UI.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error_code: "UNAUTHORIZED", error_message: "Missing auth token" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return json({ error_code: "UNAUTHORIZED", error_message: "Invalid token" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // ── Super Admin check ────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRec } = await adminClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (!adminRec) {
      return json({ error_code: "FORBIDDEN", error_message: "Acceso denegado: no eres Super Admin" }, 403);
    }

    // ── Parse body ───────────────────────────────────
    const body = await req.json();
    const { to, subject, html, text, cc, bcc } = body;

    // Validate
    if (!to || (Array.isArray(to) && to.length === 0)) {
      return json({ error_code: "MISSING_RECIPIENT", error_message: "El campo 'to' es obligatorio", phase: "validation" }, 400);
    }
    if (!subject?.trim()) {
      return json({ error_code: "MISSING_SUBJECT", error_message: "El campo 'subject' es obligatorio", phase: "validation" }, 400);
    }
    if (!html?.trim() && !text?.trim()) {
      return json({ error_code: "MISSING_BODY", error_message: "El cuerpo del email (html o text) es obligatorio", phase: "validation" }, 400);
    }

    // ── Get settings ─────────────────────────────────
    const { data: settings } = await adminClient
      .from("system_email_settings")
      .select("from_email, from_name, reply_to, is_enabled")
      .maybeSingle();

    if (!settings?.is_enabled) {
      return json({ error_code: "EMAIL_DISABLED", error_message: "El sistema de email no está habilitado. Actívalo en el Setup Wizard.", phase: "validation" }, 400);
    }

    // ── Send via Resend ──────────────────────────────
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return json({ error_code: "MISSING_RESEND_KEY", error_message: "RESEND_API_KEY no configurada en secrets", phase: "provider" }, 500);
    }

    const toArray = Array.isArray(to) ? to : [to];
    const fromField = settings.from_name
      ? `${settings.from_name} <${settings.from_email}>`
      : settings.from_email;

    const resendPayload: Record<string, unknown> = {
      from: fromField,
      to: toArray,
      subject: subject.trim(),
    };
    if (html?.trim()) resendPayload.html = html;
    if (text?.trim()) resendPayload.text = text;
    if (settings.reply_to) resendPayload.reply_to = settings.reply_to;
    if (cc) resendPayload.cc = Array.isArray(cc) ? cc : [cc];
    if (bcc) resendPayload.bcc = Array.isArray(bcc) ? bcc : [bcc];

    // Idempotency key
    const idempotencyKey = crypto.randomUUID();
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();

    let sendOk = false;
    let providerMessageId: string | null = null;
    let providerError: string | null = null;

    if (resendRes.ok && resendData.id) {
      sendOk = true;
      providerMessageId = resendData.id;
    } else {
      providerError = resendData.message || resendData.error || JSON.stringify(resendData);
    }

    // ── Log to system_email_messages ─────────────────
    try {
      await adminClient.from("system_email_messages").insert({
        direction: "outbound",
        folder: "SENT",
        provider: "resend",
        provider_message_id: providerMessageId,
        provider_status: sendOk ? "sent" : "failed",
        from_raw: settings.from_email,
        to_raw: toArray,
        cc_raw: cc ? (Array.isArray(cc) ? cc : [cc]) : [],
        bcc_raw: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [],
        subject: subject.trim(),
        snippet: (text || html || "").substring(0, 200),
        text_body: text || null,
        html_body: html || null,
        sent_at: sendOk ? new Date().toISOString() : null,
      });
    } catch (dbErr) {
      console.error("[system-email-send] DB log failed:", dbErr);
      // Non-fatal: send result is more important
    }

    if (!sendOk) {
      return json({
        error_code: "RESEND_SEND_FAILED",
        error_message: `Resend rechazó el envío: ${providerError}`,
        phase: "provider",
        provider_response: providerError,
      }, 502);
    }

    return json({
      ok: true,
      provider_message_id: providerMessageId,
      message: `Email enviado a ${toArray.join(", ")}`,
    });
  } catch (err) {
    console.error("[system-email-send] Unexpected:", err);
    return json({ error_code: "INTERNAL_ERROR", error_message: err.message || "Error interno", phase: "unknown" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
