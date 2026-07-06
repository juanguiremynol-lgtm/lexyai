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

  // dedupe by wa_message_id
  if (msg.waMessageId) {
    const { data: dup } = await sb
      .from("whatsapp_messages")
      .select("id")
      .eq("wa_message_id", msg.waMessageId)
      .maybeSingle();
    if (dup) {
      return new Response(JSON.stringify({ ok: true, note: "dup" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

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
    .select("id, status, opted_out, organization_id, identity_id")
    .maybeSingle();

  if (!conv) {
    return new Response(JSON.stringify({ ok: true, note: "conv_missing" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // record inbound
  await sb.from("whatsapp_messages").insert({
    conversation_id: (conv as { id: string }).id,
    wa_message_id: msg.waMessageId || null,
    direction: "in",
    body: msg.text ?? null,
    message_type: msg.type,
    status: "received",
  } as never);

  // opted-out or human-handled: don't dispatch bot
  const c = conv as { status: string; opted_out: boolean };
  if (c.opted_out || c.status === "human_active" || c.status === "closed") {
    return new Response(JSON.stringify({ ok: true, note: "not_bot" }), {
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
