/**
 * WhatsApp Admin Send — a platform/org admin takes over a conversation and
 * sends a manual text reply. Pauses the bot for that conversation.
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.3";
import { readWhatsAppEnv, sendWhatsAppText } from "../_shared/whatsappProvider.ts";
import { makeServiceClient } from "../_shared/whatsappTools.ts";

const BodySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().min(1).max(3500),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return new Response("unauthorized", { status: 401 });

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } },
  );
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes?.user;
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return new Response(JSON.stringify({ error: body.error.flatten() }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = makeServiceClient();

  // Authorize: platform admin or org admin for the conversation's org
  const { data: conv } = await sb
    .from("whatsapp_conversations")
    .select("id, phone_e164, organization_id")
    .eq("id", body.data.conversation_id)
    .maybeSingle();
  if (!conv) return new Response("not_found", { status: 404 });

  const { data: isPlatform } = await sb.rpc("is_platform_admin_uid", { _uid: user.id } as never).single();
  let allowed = Boolean(isPlatform);
  if (!allowed && (conv as { organization_id: string | null }).organization_id) {
    const { data: membership } = await sb
      .from("organization_memberships")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", (conv as { organization_id: string }).organization_id!)
      .maybeSingle();
    const role = (membership as { role?: string } | null)?.role ?? "";
    if (role === "admin" || role === "owner") allowed = true;
  }
  if (!allowed) return new Response("forbidden", { status: 403 });

  const env = readWhatsAppEnv();
  if (!env) {
    return new Response(JSON.stringify({ error: "wa_not_configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const send = await sendWhatsAppText(env, (conv as { phone_e164: string }).phone_e164, body.data.text);

  await sb.from("whatsapp_messages").insert({
    conversation_id: (conv as { id: string }).id,
    wa_message_id: send.wa_message_id ?? null,
    direction: "out",
    body: body.data.text,
    message_type: "text",
    status: send.ok ? "sent" : "error",
    error: send.error ?? null,
    sent_by_user_id: user.id,
  } as never);

  await sb
    .from("whatsapp_conversations")
    .update({
      status: "human_active",
      last_message_at: new Date().toISOString(),
    } as never)
    .eq("id", (conv as { id: string }).id);

  return new Response(JSON.stringify({ ok: send.ok, error: send.error ?? null }), {
    status: send.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
