/**
 * system-email-inbound-webhook — Receives Resend Inbound webhook events.
 * PUBLIC endpoint (no JWT). Verifies Svix signature for authenticity.
 * Inserts inbound emails into system_email_messages.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Read raw body for signature verification ────
    const rawBody = await req.text();
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn("[inbound-webhook] Missing Svix headers");
      return json({ error: "Missing Svix signature headers" }, 400);
    }

    // ── Verify Svix signature ───────────────────────
    const webhookSecret = Deno.env.get("RESEND_INBOUND_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[inbound-webhook] RESEND_INBOUND_WEBHOOK_SECRET not set");
      return json({ error: "Webhook secret not configured", error_code: "WEBHOOK_SECRET_MISSING" }, 500);
    }

    const verified = await verifySvixSignature(
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      webhookSecret
    );
    if (!verified) {
      console.warn("[inbound-webhook] Signature verification failed");
      return json({ error: "Invalid signature" }, 401);
    }

    // ── Idempotency check ───────────────────────────
    const { error: idempotencyErr } = await adminClient
      .from("system_email_events")
      .insert({
        provider: "resend",
        event_id: svixId,
        event_type: "inbound",
        payload: JSON.parse(rawBody),
      });

    if (idempotencyErr) {
      if (idempotencyErr.code === "23505") {
        // Duplicate — already processed
        console.log("[inbound-webhook] Duplicate event, skipping:", svixId);
        return json({ ok: true, duplicate: true });
      }
      console.error("[inbound-webhook] Event insert error:", idempotencyErr);
    }

    // ── Parse payload ───────────────────────────────
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON payload" }, 400);
    }

    const eventType = payload.type || "email.received";

    if (eventType === "email.received") {
      const data = payload.data || payload;
      const fromEmail = data.from || data.sender || "";
      const toEmails = data.to || [];
      const ccEmails = data.cc || [];
      const subject = data.subject || "(sin asunto)";
      const textBody = data.text || null;
      const htmlBody = data.html || null;
      const snippet = (textBody || "").substring(0, 200);

      await adminClient.from("system_email_messages").insert({
        direction: "inbound",
        folder: "INBOX",
        provider: "resend",
        provider_message_id: data.id || svixId,
        provider_status: "received",
        from_raw: fromEmail,
        to_raw: Array.isArray(toEmails) ? toEmails : [toEmails],
        cc_raw: Array.isArray(ccEmails) ? ccEmails : [ccEmails],
        bcc_raw: [],
        subject,
        snippet,
        text_body: textBody,
        html_body: htmlBody,
        received_at: new Date().toISOString(),
      });

      // Update setup state
      await adminClient
        .from("system_email_setup_state")
        .update({ step_inbound_ok: true })
        .eq("id", "00000000-0000-0000-0000-000000000001");

      console.log("[inbound-webhook] Inbound email stored:", subject);
    } else {
      console.log("[inbound-webhook] Unhandled event type:", eventType);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[inbound-webhook] Unexpected:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

// ── Svix signature verification ─────────────────────────
async function verifySvixSignature(
  rawBody: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): Promise<boolean> {
  try {
    // Svix secret format: whsec_<base64>
    const secretBytes = base64Decode(
      secret.startsWith("whsec_") ? secret.slice(6) : secret
    );

    const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(toSign));
    const computedSig = base64Encode(new Uint8Array(signature));

    // Svix sends multiple signatures separated by space
    const signatures = svixSignature.split(" ");
    return signatures.some((sig) => {
      const sigValue = sig.startsWith("v1,") ? sig.slice(3) : sig;
      return sigValue === computedSig;
    });
  } catch (err) {
    console.error("[inbound-webhook] Signature verify error:", err);
    return false;
  }
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
