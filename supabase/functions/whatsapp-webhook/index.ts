/**
 * WhatsApp Webhook — Meta Cloud API entry point.
 *
 * GET: verify handshake (hub.mode/hub.verify_token/hub.challenge)
 * POST: validate signature, dedupe by wa_message_id, upsert conversation,
 *        enqueue the agent via EdgeRuntime.waitUntil (respond 200 quickly).
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  parseInboundMessage,
  readWhatsAppEnv,
  sendWhatsAppText,
  verifyMetaSignature,
} from "../_shared/whatsappProvider.ts";
import { makeServiceClient } from "../_shared/whatsappTools.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const env = readWhatsAppEnv();

  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (!env) return new Response("wa_not_configured", { status: 503 });
    if (mode === "subscribe" && token === env.verifyToken && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }

  if (!env) {
    return new Response(JSON.stringify({ ok: true, note: "wa_not_configured" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const raw = await req.text();
  const signatureOk = await verifyMetaSignature(
    raw,
    req.headers.get("x-hub-signature-256"),
    env.appSecret,
  );
  if (!signatureOk) {
    return new Response("bad_signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad_json", { status: 400 });
  }

  const msg = parseInboundMessage(payload);
  if (!msg) {
    return new Response(JSON.stringify({ ok: true, note: "no_message" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = makeServiceClient();

  // upsert conversation
  const { data: conv } = await sb
    .from("whatsapp_conversations")
    .upsert(
      {
        phone_e164: msg.fromE164,
        last_inbound_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
      } as never,
      { onConflict: "phone_e164" },
    )
    .select("id, status, opted_out, organization_id, identity_id, metadata")
    .maybeSingle();

  if (!conv) {
    return new Response(JSON.stringify({ ok: true, note: "conv_missing" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // record inbound (upsert on wa_message_id UNIQUE to swallow Meta retries)
  const convId = (conv as { id: string }).id;
  const insertRes = await sb
    .from("whatsapp_messages")
    .upsert(
      {
        conversation_id: convId,
        wa_message_id: msg.waMessageId || null,
        direction: "in",
        body: msg.text ?? null,
        message_type: msg.type,
        status: "received",
      } as never,
      { onConflict: "wa_message_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (msg.waMessageId && !insertRes.data) {
    // Duplicate delivery from Meta — swallow without dispatch
    return new Response(JSON.stringify({ ok: true, note: "dup" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // opted-out or human-handled: don't dispatch bot
  const c = conv as {
    status: string;
    opted_out: boolean;
    organization_id: string | null;
    metadata: Record<string, unknown> | null;
  };
  if (c.opted_out || c.status === "human_active" || c.status === "closed") {
    return new Response(JSON.stringify({ ok: true, note: "not_bot" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── RATE LIMIT (GAP D) ─────────────────────────────────────────────
  // Verified users get a wider window than unverified; a single cooldown
  // notice is sent per window, tracked via conversations.metadata.
  const verified = !!c.organization_id;
  const { data: settings } = await sb
    .from("whatsapp_bot_settings")
    .select("rate_limit_max, rate_limit_window_minutes")
    .eq("singleton", true)
    .maybeSingle();
  const windowMin = settings?.rate_limit_window_minutes ?? 5;
  const baseMax = settings?.rate_limit_max ?? 20;
  const cap = verified ? baseMax : Math.max(3, Math.min(baseMax, 5));
  const windowStart = new Date(Date.now() - windowMin * 60_000).toISOString();
  const { count: inboundCount } = await sb
    .from("whatsapp_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", convId)
    .eq("direction", "in")
    .gte("created_at", windowStart);

  if ((inboundCount ?? 0) > cap) {
    const meta = c.metadata ?? {};
    const noticeAtStr = typeof (meta as { cooldown_notice_at?: string }).cooldown_notice_at === "string"
      ? (meta as { cooldown_notice_at: string }).cooldown_notice_at
      : null;
    const noticeAt = noticeAtStr ? Date.parse(noticeAtStr) : 0;
    const shouldSendNotice = Date.now() - noticeAt > windowMin * 60_000;
    if (shouldSendNotice) {
      try {
        await sendWhatsAppText(
          env,
          msg.fromE164,
          `Has enviado muchos mensajes en poco tiempo. Espera ~${windowMin} minutos y vuelve a escribir.`,
        );
      } catch (_e) { /* best-effort */ }
      await sb
        .from("whatsapp_conversations")
        .update({
          metadata: { ...(meta as Record<string, unknown>), cooldown_notice_at: new Date().toISOString() },
        } as never)
        .eq("id", convId);
    }
    return new Response(JSON.stringify({ ok: true, note: "rate_limited" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // dispatch to agent (fire and forget)
  const dispatchUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-agent`;
  const dispatchBody = JSON.stringify({
    phone_e164: msg.fromE164,
    text: msg.text ?? "",
    profile_name: msg.profileName ?? null,
    wa_message_id: msg.waMessageId,
  });
  const run = fetch(dispatchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: dispatchBody,
  }).catch((err) => console.error("dispatch fail", err));

  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(run);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
