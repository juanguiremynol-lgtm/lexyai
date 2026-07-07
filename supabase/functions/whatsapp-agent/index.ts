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
const HISTORY_LIMIT = 10;
const HISTORY_BODY_TRUNC = 500;
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_LOCKOUT_MINUTES = 60;
const CODE_REGEX = /\b(\d{6})\b/; // 6-digit numeric linking code

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input.trim()),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
- Si el usuario NO está verificado (sin organization_id), solo puedes: (a) explicar el servicio en 2-3 líneas, (b) registrar un lead con create_lead, (c) pedirle que genere un código de vinculación de 6 dígitos desde la app Andrómeda (Consola > WhatsApp > Identidades, o su abogado) y lo envíe por este mismo chat.
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
    .select("id, identity_id, organization_id, status, metadata")
    .eq("phone_e164", phone_e164)
    .maybeSingle();
  if (!conv) return new Response("no_conv", { status: 404 });

  const convId = (conv as { id: string }).id;

  // ── VERIFICATION SHORT-CIRCUIT ────────────────────────────────────────
  // Runs before the LLM. Matches a 6-digit linking code against
  // whatsapp_link_codes and, on hit, promotes the phone to a verified
  // identity. Applies anti-brute-force via whatsapp_verification_attempts.
  const codeMatch = (text ?? "").match(CODE_REGEX);
  const identityAlreadyVerified = !!(conv as { organization_id: string | null }).organization_id;
  if (codeMatch && !identityAlreadyVerified) {
    const verifyOutcome = await handleVerification(sb, phone_e164, codeMatch[1], convId);
    await replyAndLog(sb, convId, phone_e164, verifyOutcome.message, correlationId);
    return new Response(
      JSON.stringify({ ok: true, note: verifyOutcome.status }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!settings?.bot_enabled) {
    await replyAndLog(
      sb,
      convId,
      phone_e164,
      "Gracias por escribirnos. Un asesor de Andrómeda Legal te contactará pronto.",
      correlationId,
    );
    await sb.from("whatsapp_conversations").update({ status: "needs_human" } as never).eq("id", convId);
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
      convId,
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

  // ── CONVERSATION HISTORY (GAP E) ─────────────────────────────────────
  const { data: history } = await sb
    .from("whatsapp_messages")
    .select("direction, body, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const historyMessages = (history ?? [])
    .slice()
    .reverse()
    .filter((m: { body: string | null }) => (m.body ?? "").trim().length > 0)
    .map((m: { direction: string; body: string | null }) => ({
      role: (m.direction === "in" ? "user" : "assistant") as "user" | "assistant",
      content: (m.body ?? "").slice(0, HISTORY_BODY_TRUNC),
    }));
  // Ensure the current turn is present as the last user message
  const messagesForModel = [
    ...historyMessages,
    { role: "user" as const, content: text ?? "" },
  ];

  let reply = "Gracias por escribirnos. Un momento.";
  try {
    const result = await generateText({
      model,
      system: systemFull,
      messages: messagesForModel,
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
      .eq("id", convId);
  }

  await replyAndLog(sb, convId, phone_e164, reply, correlationId);

  return new Response(JSON.stringify({ ok: true, correlation_id: correlationId }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

// ═════════════════════════════════════════════════════════════════════
// Verification helpers
// ═════════════════════════════════════════════════════════════════════

async function handleVerification(
  sb: ReturnType<typeof makeServiceClient>,
  phone: string,
  code: string,
  conversationId: string,
): Promise<{ status: string; message: string }> {
  // Anti-brute-force gate
  const { data: attempt } = await sb
    .from("whatsapp_verification_attempts")
    .select("id, attempts, locked_until")
    .eq("phone_e164", phone)
    .maybeSingle();
  const now = Date.now();
  const lockedUntil = attempt?.locked_until ? Date.parse(attempt.locked_until) : 0;
  if (lockedUntil > now) {
    return {
      status: "locked",
      message: "Has superado el número de intentos. Intenta de nuevo en 1 hora.",
    };
  }

  const codeHash = await sha256Hex(code);
  const nowIso = new Date().toISOString();
  const { data: link } = await sb
    .from("whatsapp_link_codes")
    .select("id, user_id, organization_id, expires_at, consumed_at")
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (!link) {
    const nextAttempts = (attempt?.attempts ?? 0) + 1;
    const shouldLock = nextAttempts >= VERIFY_MAX_ATTEMPTS;
    await sb
      .from("whatsapp_verification_attempts")
      .upsert(
        {
          phone_e164: phone,
          attempts: nextAttempts,
          locked_until: shouldLock
            ? new Date(now + VERIFY_LOCKOUT_MINUTES * 60_000).toISOString()
            : null,
          expires_at: new Date(now + VERIFY_LOCKOUT_MINUTES * 60_000).toISOString(),
        } as never,
        { onConflict: "phone_e164" },
      );
    return {
      status: shouldLock ? "locked_now" : "invalid_code",
      message: shouldLock
        ? "Demasiados intentos fallidos. Bloqueo temporal de 1 hora."
        : "Ese código no es válido o expiró. Genera uno nuevo desde la app.",
    };
  }

  const l = link as {
    id: string;
    user_id: string;
    organization_id: string | null;
  };

  // Upsert identity as verified
  const { data: identity, error: idErr } = await sb
    .from("whatsapp_identities")
    .upsert(
      {
        phone_e164: phone,
        user_id: l.user_id,
        organization_id: l.organization_id,
        status: "verified",
        verified_at: nowIso,
        last_seen_at: nowIso,
      } as never,
      { onConflict: "phone_e164" },
    )
    .select("id")
    .maybeSingle();

  if (idErr || !identity) {
    return { status: "identity_error", message: "No pude vincular tu número. Intenta más tarde." };
  }

  await sb
    .from("whatsapp_link_codes")
    .update({ consumed_at: nowIso, consumed_phone_e164: phone } as never)
    .eq("id", l.id);

  await sb
    .from("whatsapp_conversations")
    .update({
      identity_id: (identity as { id: string }).id,
      organization_id: l.organization_id,
    } as never)
    .eq("id", conversationId);

  // Reset attempts counter on success
  await sb
    .from("whatsapp_verification_attempts")
    .upsert(
      { phone_e164: phone, attempts: 0, locked_until: null } as never,
      { onConflict: "phone_e164" },
    );

  return {
    status: "verified",
    message: "¡Listo! Tu número quedó vinculado. Ya puedes consultarme por tus procesos.",
  };
}
