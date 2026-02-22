/**
 * generate-contract-draft — AI-assisted contract clause drafting for contrato_servicios.
 *
 * Supports two fields:
 *   - OBJETO: Service scope / object of representation
 *   - HONORARIOS: Fee structure and payment terms
 *
 * Uses Lovable AI (Gemini) to generate context-aware, legally appropriate
 * Spanish legal clauses. Returns multiple draft variants.
 *
 * GUARDRAILS:
 *   - Never hallucinate amounts, dates, or case-specific facts
 *   - If critical inputs missing, returns a follow-up question
 *   - No signed URLs or sensitive artifacts in AI context
 *   - Audit log records only usage metadata, not conversation content
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type DraftField = "OBJETO" | "HONORARIOS";

// ── System prompts ──

const OBJETO_SYSTEM_PROMPT = `Eres un asistente legal experto en derecho colombiano, especializado en la redacción de contratos de prestación de servicios profesionales de abogado.

Tu tarea es generar la cláusula de OBJETO DEL CONTRATO para un contrato de mandato de servicios legales.

REGLAS ESTRICTAS:
1. SIEMPRE responde en español formal jurídico colombiano.
2. NUNCA inventes hechos específicos del caso (montos, fechas, nombres de partes, pretensiones, radicados) que no estén en el contexto proporcionado.
3. Si el tipo de proceso o hechos relevantes no son claros, genera una cláusula genérica y señálalo como suposición.
4. Genera EXACTAMENTE 3 variantes con estos títulos:
   - "Estándar": Alcance equilibrado de representación
   - "Alcance limitado": Más restringido, reduce riesgo para el abogado
   - "Alcance amplio": Incluye recursos, medidas cautelares, instancias adicionales
5. Cada variante debe ser texto plano (sin markdown, sin HTML), listo para pegar en un campo de formulario.
6. Máximo 500 caracteres por variante.
7. Redacción en tercera persona ("EL MANDANTE confiere mandato a EL MANDATARIO para...").
8. Adapta al tipo de proceso y jurisdicción cuando estén disponibles.
9. Si falta información crítica (no sabes qué tipo de servicio legal se prestará), responde con UNA pregunta clarificadora breve.

Formato de respuesta cuando generas variantes:
VARIANTE_ESTANDAR:
[texto]
VARIANTE_LIMITADA:
[texto]
VARIANTE_AMPLIA:
[texto]

Formato cuando necesitas más información:
PREGUNTA: [tu pregunta aquí]`;

const HONORARIOS_SYSTEM_PROMPT = `Eres un asistente legal experto en derecho colombiano, especializado en la estructura de honorarios para contratos de mandato de servicios profesionales de abogado.

Tu tarea es generar la cláusula de HONORARIOS Y FORMA DE PAGO para un contrato de servicios legales.

REGLAS ESTRICTAS:
1. SIEMPRE responde en español formal jurídico colombiano.
2. NUNCA inventes montos, valores, porcentajes, ni fechas de pago. Si no tienes estos datos, DEBES solicitar:
   - Valor total de los honorarios (o estructura preferida)
   - Forma de pago / calendario de pagos
   - Si los gastos procesales están incluidos o excluidos
3. Genera EXACTAMENTE 2 variantes:
   - "Suma global": Pago en una sola cuota o cuotas fijas
   - "Cuotas por hitos": Pagos atados a momentos procesales
4. Si el usuario proporcionó montos, úsalos exactamente como los dio.
5. Si NO se proporcionaron montos, incluye marcadores claros como [VALOR TOTAL], [MONTO CUOTA 1], etc. — NO inventes cifras.
6. Cada variante debe ser texto plano (sin markdown, sin HTML).
7. Máximo 600 caracteres por variante.
8. Incluir siempre: (a) cláusula de no pago = suspensión del servicio; (b) mención de gastos procesales.
9. Si falta información crítica (no conoces el monto ni la estructura de pago), responde con UNA pregunta breve pidiendo: valor total y calendario de pago.

Formato de respuesta cuando generas variantes:
VARIANTE_GLOBAL:
[texto]
VARIANTE_HITOS:
[texto]

Formato cuando necesitas más información:
PREGUNTA: [tu pregunta aquí]`;

interface RequestBody {
  doc_type: string;
  field: DraftField;
  context: {
    work_item_id: string;
    wizard_variables?: Record<string, string>;
    honorarios_data?: any;
    service_object?: string;
  };
  user_prompt?: string;
  regenerate?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: RequestBody = await req.json();
    const { field, context, user_prompt, regenerate } = body;

    if (!context?.work_item_id || !field) {
      return new Response(
        JSON.stringify({ error: "work_item_id and field are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (field !== "OBJETO" && field !== "HONORARIOS") {
      return new Response(
        JSON.stringify({ error: "field must be OBJETO or HONORARIOS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch work item context
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: workItem, error: wiErr } = await adminClient
      .from("work_items")
      .select("id, radicado, workflow_type, authority_name, authority_city, authority_department, demandantes, demandados, title, description, stage, organization_id, client_id")
      .eq("id", context.work_item_id)
      .single();

    if (wiErr || !workItem) {
      return new Response(
        JSON.stringify({ error: "Work item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify org membership
    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id, firma_abogado_nombre_completo")
      .eq("id", user.id)
      .single();

    if (profile?.organization_id !== workItem.organization_id) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch client info (high-level only, no full ID numbers)
    let clientInfo: { name?: string; type?: string } = {};
    if (workItem.client_id) {
      const { data: client } = await adminClient
        .from("clients")
        .select("name")
        .eq("id", workItem.client_id)
        .single();
      if (client) clientInfo.name = client.name;
    }

    // ── Build context ──
    const contextParts: string[] = [];

    const vars = context.wizard_variables || {};
    const workflowLabel = vars.case_type || workItem.workflow_type || "No especificado";
    contextParts.push(`TIPO DE PROCESO: ${workflowLabel}`);

    if (workItem.radicado) contextParts.push(`RADICADO: ${workItem.radicado}`);
    if (workItem.authority_name) contextParts.push(`DESPACHO: ${workItem.authority_name}`);
    if (workItem.authority_city) contextParts.push(`CIUDAD: ${workItem.authority_city}`);

    const clientName = vars.client_full_name || clientInfo.name || workItem.demandantes || "No especificado";
    contextParts.push(`CLIENTE (MANDANTE): ${clientName}`);

    const lawyerName = vars.lawyer_full_name || profile?.firma_abogado_nombre_completo || "No especificado";
    contextParts.push(`ABOGADO (MANDATARIO): ${lawyerName}`);

    if (workItem.demandados) contextParts.push(`PARTE CONTRARIA: ${workItem.demandados}`);
    if (workItem.stage) contextParts.push(`ETAPA PROCESAL: ${workItem.stage}`);

    // Field-specific context
    if (field === "OBJETO") {
      const currentObj = context.service_object || vars.case_description || workItem.title || workItem.description;
      if (currentObj && regenerate) {
        contextParts.push(`OBJETO ACTUAL (el usuario quiere mejorar): ${currentObj}`);
      } else if (currentObj && !regenerate) {
        contextParts.push(`DESCRIPCIÓN DEL ASUNTO: ${currentObj}`);
      }
    }

    if (field === "HONORARIOS") {
      const hd = context.honorarios_data;
      if (hd) {
        contextParts.push(`TIPO DE HONORARIOS SELECCIONADO: ${hd.honorarios_type || "no seleccionado"}`);
        if (hd.fixed_component?.amount > 0) {
          contextParts.push(`MONTO DE HONORARIOS: $${hd.fixed_component.amount} COP`);
        }
        if (hd.cuota_litis?.percentage > 0) {
          contextParts.push(`CUOTA LITIS: ${hd.cuota_litis.percentage}%`);
        }
        if (hd.monthly_fee?.amount > 0) {
          contextParts.push(`MENSUALIDAD: $${hd.monthly_fee.amount} COP`);
        }
      }
      if (vars.honorarios_clause && regenerate) {
        contextParts.push(`CLÁUSULA ACTUAL (el usuario quiere mejorar): ${vars.honorarios_clause.substring(0, 500)}`);
      }
    }

    const contextBlock = contextParts.join("\n");

    // Build user message
    let userMessage = field === "OBJETO"
      ? `Genera la cláusula de OBJETO DEL CONTRATO con el siguiente contexto:\n\n${contextBlock}`
      : `Genera la cláusula de HONORARIOS Y FORMA DE PAGO con el siguiente contexto:\n\n${contextBlock}`;

    if (user_prompt?.trim()) {
      userMessage += `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO: ${user_prompt.trim()}`;
    }

    if (regenerate) {
      userMessage += "\n\nEl usuario ha solicitado regenerar. Genera variantes diferentes manteniendo coherencia con el contexto.";
    }

    const systemPrompt = field === "OBJETO" ? OBJETO_SYSTEM_PROMPT : HONORARIOS_SYSTEM_PROMPT;

    // ── Call Gemini ──
    const aiResponse = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.45,
        max_tokens: 3000,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Límite de solicitudes excedido. Intente de nuevo en unos momentos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos de IA insuficientes." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await aiResponse.text();
      console.error("[generate-contract-draft] AI gateway error:", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Error del servicio de IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // ── Parse output ──
    const result = parseAIOutput(rawContent, field, contextParts);

    // ── Audit log (metadata only, no conversation content) ──
    try {
      await adminClient.from("audit_logs").insert({
        organization_id: workItem.organization_id,
        actor_user_id: user.id,
        actor_type: "USER",
        entity_type: "WORK_ITEM",
        entity_id: context.work_item_id,
        action: `AI_GENERATE_CONTRACT_${field}`,
        metadata: {
          field,
          context_keys_provided: contextParts.map(p => p.split(":")[0]),
          had_follow_up: !!result.follow_up_question,
          user_prompt_provided: !!user_prompt?.trim(),
          regenerate: !!regenerate,
          drafts_count: result.drafts.length,
        },
      });
    } catch (logErr) {
      console.warn("[generate-contract-draft] Audit log failed:", logErr);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-contract-draft] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

interface DraftResult {
  drafts: { title: string; text: string }[];
  follow_up_question: string | null;
  assumptions: string[];
}

function parseAIOutput(raw: string, field: DraftField, contextParts: string[]): DraftResult {
  const trimmed = raw.trim()
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "");

  // Check for follow-up question
  if (trimmed.startsWith("PREGUNTA:")) {
    return {
      drafts: [],
      follow_up_question: trimmed.replace(/^PREGUNTA:\s*/i, "").trim(),
      assumptions: [],
    };
  }

  const drafts: { title: string; text: string }[] = [];

  if (field === "OBJETO") {
    const estandar = extractBetween(trimmed, "VARIANTE_ESTANDAR:", "VARIANTE_LIMITADA:");
    const limitada = extractBetween(trimmed, "VARIANTE_LIMITADA:", "VARIANTE_AMPLIA:");
    const amplia = extractAfter(trimmed, "VARIANTE_AMPLIA:");

    if (estandar) drafts.push({ title: "Estándar", text: estandar.trim() });
    if (limitada) drafts.push({ title: "Alcance limitado", text: limitada.trim() });
    if (amplia) drafts.push({ title: "Alcance amplio", text: amplia.trim() });
  } else {
    const global = extractBetween(trimmed, "VARIANTE_GLOBAL:", "VARIANTE_HITOS:");
    const hitos = extractAfter(trimmed, "VARIANTE_HITOS:");

    if (global) drafts.push({ title: "Suma global", text: global.trim() });
    if (hitos) drafts.push({ title: "Cuotas por hitos", text: hitos.trim() });
  }

  // Fallback: if parsing failed, treat entire output as single draft
  if (drafts.length === 0 && trimmed.length > 20) {
    drafts.push({ title: "Borrador", text: trimmed.substring(0, 600) });
  }

  // Enforce max length
  for (const d of drafts) {
    if (d.text.length > 800) {
      d.text = d.text.substring(0, 800);
      const lastPeriod = d.text.lastIndexOf(".");
      if (lastPeriod > 600) d.text = d.text.substring(0, lastPeriod + 1);
    }
  }

  // Infer assumptions
  const assumptions: string[] = [];
  const hasProcess = contextParts.some(p => p.startsWith("TIPO DE PROCESO:") && !p.includes("No especificado") && !p.includes("UNKNOWN"));
  if (!hasProcess) assumptions.push("Tipo de proceso no especificado — cláusula genérica.");

  if (field === "HONORARIOS") {
    const hasAmount = contextParts.some(p => p.startsWith("MONTO DE HONORARIOS:"));
    if (!hasAmount) assumptions.push("Montos no proporcionados — se usaron marcadores [VALOR].");
  }

  return { drafts, follow_up_question: null, assumptions };
}

function extractBetween(text: string, startMarker: string, endMarker: string): string | null {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return null;
  const endIdx = text.indexOf(endMarker, startIdx);
  if (endIdx === -1) return text.substring(startIdx + startMarker.length).trim();
  return text.substring(startIdx + startMarker.length, endIdx).trim();
}

function extractAfter(text: string, marker: string): string | null {
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  return text.substring(idx + marker.length).trim();
}
