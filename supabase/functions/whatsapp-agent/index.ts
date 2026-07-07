/**
 * WhatsApp Agent — routes an inbound message to the AI (or verification flow),
 * runs tools, and sends the reply back through the WhatsApp provider.
 *
 * Auth: internal only (invoked by whatsapp-webhook with service role bearer).
 */

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { generateText } from "npm:ai@4.0.14";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible@0.2.14";
import { readWhatsAppEnv, sendWhatsAppText } from "../_shared/whatsappProvider.ts";
import { buildWhatsAppTools, makeServiceClient, ToolContext } from "../_shared/whatsappTools.ts";

const MODEL_ID = "google/gemini-3-flash-preview";

function makeGateway(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

const SYSTEM_PROMPT = `Eres el asistente de atención al cliente de Andrómeda Legal en WhatsApp.
Tono: cálido, profesional, breve (máx 4 líneas por mensaje). Español colombiano.
Reglas duras:
- NUNCA das asesoría jurídica ni interpretas normas. Solo información operativa del proceso.
- NUNCA inventas datos: si una herramienta no devuelve resultado, dilo con honestidad.
- Alcance permitido: consultar procesos del usuario (actuaciones, publicaciones, próximos vencimientos), solicitar refresh, registrar prospectos, escalar a humano.
- Si el usuario NO está verificado (sin organization_id), solo puedes: (a) explicar el servicio en 2-3 líneas, (b) registrar un lead con create_lead, (c) pedirle su correo para iniciar verificación.
- Si el proceso pertenece a una categoría no elegible para sync externo, informa que la consulta debe hacerla el abogado manualmente.
- Si te preguntan por algo fuera del scope legal-operativo, ofrece escalar a humano.
- Máximo 5 llamadas a herramientas por respuesta.`;

async function replyAndLog(
  sb: ReturnType<typeof makeServiceClient>,
  conversationId: string,
  phoneE164: string,
  text: string,
  correlationId: string,
) {
  const env = readWhatsAppEnv();
  if (!env) return;
  const res = await sendWhatsAppText(env, phoneE164, text);
  await sb.from("whatsapp_messages").insert({
    conversation_id: conversationId,
    wa_message_id: res.wa_message_id ?? null,
    direction: "out",
    body: text,
    message_type: "text",
    status: res.ok ? "sent" : "error",
    error: res.error ?? null,
    correlation_id: correlationId,
  } as never);
  await sb
    .from("whatsapp_conversations")
    .update({ last_message_at: new Date().toISOString() } as never)
    .eq("id", conversationId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });

  const bearer = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!bearer.includes(serviceKey) || !serviceKey) {
    return new Response("unauthorized", { status: 401 });
  }

  const { phone_e164, text } = (await req.json().catch(() => ({}))) as {
    phone_e164?: string;
    text?: string;
  };
  if (!phone_e164) return new Response("bad_input", { status: 400 });

  const sb = makeServiceClient();
  const correlationId = crypto.randomUUID();

  // Load settings
  const { data: settings } = await sb
    .from("whatsapp_bot_settings")
    .select("bot_enabled, services_knowledge_base")
    .eq("singleton", true)
    .maybeSingle();

  const { data: conv } = await sb
    .from("whatsapp_conversations")
    .select("id, identity_id, organization_id, status")
    .eq("phone_e164", phone_e164)
    .maybeSingle();
  if (!conv) return new Response("no_conv", { status: 404 });

  if (!settings?.bot_enabled) {
    await replyAndLog(
      sb,
      (conv as { id: string }).id,
      phone_e164,
      "Gracias por escribirnos. Un asesor de Andrómeda Legal te contactará pronto.",
      correlationId,
    );
    await sb.from("whatsapp_conversations").update({ status: "needs_human" } as never).eq("id", (conv as { id: string }).id);
    return new Response(JSON.stringify({ ok: true, note: "bot_disabled" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Load identity if any
  let identityUserId: string | null = null;
  let identityOrgId: string | null = null;
  if ((conv as { identity_id: string | null }).identity_id) {
    const { data: ident } = await sb
      .from("whatsapp_identities")
      .select("user_id, organization_id, status")
      .eq("id", (conv as { identity_id: string }).identity_id!)
      .maybeSingle();
    if (ident && (ident as { status: string }).status === "verified") {
      identityUserId = (ident as { user_id: string }).user_id;
      identityOrgId = (ident as { organization_id: string | null }).organization_id;
    }
  }

  const ctx: ToolContext = {
    supabase: sb,
    identityId: (conv as { identity_id: string | null }).identity_id,
    userId: identityUserId,
    organizationId: identityOrgId,
    phoneE164: phone_e164,
    correlationId,
  };

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) {
    await replyAndLog(
      sb,
      (conv as { id: string }).id,
      phone_e164,
      "Estamos con inconvenientes técnicos. Un asesor te contactará pronto.",
      correlationId,
    );
    return new Response(JSON.stringify({ ok: true, note: "no_ai_key" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gateway = makeGateway(lovableKey);
  const model = gateway(MODEL_ID);

  const identityBlock = identityOrgId
    ? `Usuario VERIFICADO. organization_id=${identityOrgId}.`
    : `Usuario NO verificado. Solo puedes registrar lead, explicar el servicio brevemente o pedir correo para verificación.`;

  const systemFull = `${SYSTEM_PROMPT}\n\n[Contexto]\n${identityBlock}\nServicio: ${settings?.services_knowledge_base ?? ""}`;

  let reply = "Gracias por escribirnos. Un momento.";
  try {
    const result = await generateText({
      model,
      system: systemFull,
      prompt: text ?? "",
      tools: buildWhatsAppTools(ctx),
      // hard tool-call budget
      maxSteps: 5,
    });
    reply = result.text?.trim() || "Recibí tu mensaje. Un asesor lo revisará.";
  } catch (err) {
    console.error("agent_error", err);
    reply = "Tuve un problema procesando tu mensaje. Un asesor te contactará.";
    await sb
      .from("whatsapp_conversations")
      .update({ status: "needs_human" } as never)
      .eq("id", (conv as { id: string }).id);
  }

  await replyAndLog(sb, (conv as { id: string }).id, phone_e164, reply, correlationId);

  return new Response(JSON.stringify({ ok: true, correlation_id: correlationId }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
