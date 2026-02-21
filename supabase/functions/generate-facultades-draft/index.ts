/**
 * generate-facultades-draft — AI-assisted Facultades drafting for POA wizard.
 *
 * Uses Lovable AI (Gemini) to generate a legally appropriate, context-aware
 * numbered list of facultades for Colombian Power of Attorney documents.
 *
 * Input: structured context from Work Item + wizard state.
 * Output: draftText (Spanish numbered list), assumptions[], optional followUpQuestion.
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

// ── System prompt for Facultades generation ──
const SYSTEM_PROMPT = `Eres un asistente legal experto en derecho procesal colombiano, especializado en la redacción de poderes especiales judiciales.

Tu tarea es generar la cláusula de FACULTADES para un poder especial, siguiendo las convenciones de redacción legal colombiana.

REGLAS ESTRICTAS:
1. SIEMPRE responde en español formal jurídico colombiano.
2. Las facultades DEBEN estar en formato de lista numerada.
3. NUNCA inventes hechos del caso (montos, fechas, nombres de partes, pretensiones específicas) que no estén en el contexto proporcionado.
4. Si falta información crítica (como el objeto del poder o tipo de proceso), DEBES responder con una pregunta clarificadora breve en lugar de inventar.
5. Las facultades deben ser consistentes con los artículos 73, 74 y 75 del Código General del Proceso (CGP).
6. NO incluyas la frase estándar sobre "Las anteriores facultades se entienden conferidas..." — esa ya está en el template.
7. Longitud máxima: 2000 caracteres.
8. Adapta las facultades al tipo de proceso y jurisdicción cuando estén disponibles.

FACULTADES ESTÁNDAR que debes incluir (salvo que el contexto indique lo contrario):
- Presentar, impulsar y retirar demandas o solicitudes
- Contestar demandas, excepciones y reconvenciones
- Asistir a audiencias y diligencias judiciales
- Solicitar, presentar y controvertir pruebas
- Recibir notificaciones judiciales
- Interponer recursos ordinarios y extraordinarios
- Conciliar, transigir y desistir (con redacción cautelosa si no hay instrucción explícita)
- Sustituir total o parcialmente el poder y reasumirlo

FACULTADES OPCIONALES (incluir solo si el contexto lo indica o el usuario lo pide):
- Recibir dineros u obligaciones
- Firmar contratos o acuerdos
- Representar en diligencias administrativas
- Actuar en procesos ejecutivos derivados

Cuando respondas con una pregunta clarificadora, usa el formato:
PREGUNTA: [tu pregunta aquí]

Cuando respondas con las facultades, usa el formato:
FACULTADES:
1. [primera facultad]
2. [segunda facultad]
...`;

interface RequestBody {
  workItemId: string;
  wizardState: Record<string, string>;
  userPrompt?: string;
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
    const { workItemId, wizardState, userPrompt, regenerate } = body;

    if (!workItemId) {
      return new Response(
        JSON.stringify({ error: "workItemId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch work item context (using service role for reliability)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: workItem, error: wiErr } = await adminClient
      .from("work_items")
      .select("id, radicado, workflow_type, authority_name, authority_city, authority_department, demandantes, demandados, title, description, stage, organization_id")
      .eq("id", workItemId)
      .single();

    if (wiErr || !workItem) {
      return new Response(
        JSON.stringify({ error: "Work item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify user belongs to the work item's org
    const { data: profile } = await adminClient
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    if (profile?.organization_id !== workItem.organization_id) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build context for the AI ──
    const contextParts: string[] = [];

    // Work item metadata
    contextParts.push(`TIPO DE PROCESO: ${wizardState.case_type || workItem.workflow_type || "No especificado"}`);
    
    if (workItem.radicado) {
      contextParts.push(`RADICADO: ${workItem.radicado}`);
    }
    if (workItem.authority_name) {
      contextParts.push(`DESPACHO: ${workItem.authority_name}`);
    }
    if (workItem.authority_city) {
      contextParts.push(`CIUDAD: ${workItem.authority_city}`);
    }
    if (workItem.authority_department) {
      contextParts.push(`DEPARTAMENTO: ${workItem.authority_department}`);
    }

    // Parties
    const poderdante = wizardState.client_full_name || workItem.demandantes || "No especificado";
    contextParts.push(`PODERDANTE: ${poderdante}`);
    
    if (workItem.demandados) {
      contextParts.push(`PARTE CONTRARIA: ${workItem.demandados}`);
    }
    if (wizardState.opposing_party) {
      contextParts.push(`PARTE CONTRARIA (wizard): ${wizardState.opposing_party}`);
    }

    // Object of representation
    const caseDescription = wizardState.case_description || workItem.title || workItem.description;
    if (caseDescription) {
      contextParts.push(`OBJETO DEL PODER / DESCRIPCIÓN DEL ASUNTO: ${caseDescription}`);
    }

    // Stage info
    if (workItem.stage) {
      contextParts.push(`ETAPA PROCESAL: ${workItem.stage}`);
    }

    // Existing facultades (for regeneration context)
    if (wizardState.faculties && regenerate) {
      contextParts.push(`FACULTADES ACTUALES (el usuario quiere mejorar/regenerar): ${wizardState.faculties}`);
    }

    const contextBlock = contextParts.join("\n");

    // Build user message
    let userMessage = `Genera las FACULTADES para un poder especial con el siguiente contexto:\n\n${contextBlock}`;
    
    if (userPrompt?.trim()) {
      userMessage += `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO: ${userPrompt.trim()}`;
    }

    if (regenerate) {
      userMessage += "\n\nEl usuario ha solicitado regenerar las facultades. Genera una versión diferente manteniendo la coherencia con el contexto.";
    }

    // ── Call Gemini via Lovable AI Gateway ──
    const aiResponse = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.4,
        max_tokens: 2000,
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
      console.error("[generate-facultades] AI gateway error:", aiResponse.status, errText);
      return new Response(
        JSON.stringify({ error: "Error del servicio de IA" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // ── Parse output ──
    const result = parseAIOutput(rawContent, contextParts);

    // ── Log usage ──
    try {
      await adminClient.from("audit_logs").insert({
        organization_id: workItem.organization_id,
        actor_user_id: user.id,
        actor_type: "USER",
        entity_type: "WORK_ITEM",
        entity_id: workItemId,
        action: "AI_GENERATE_FACULTADES",
        metadata: {
          context_keys_provided: contextParts.map(p => p.split(":")[0]),
          had_follow_up_question: !!result.followUpQuestion,
          user_prompt_provided: !!userPrompt?.trim(),
          regenerate: !!regenerate,
          draft_length: result.draftText?.length || 0,
        },
      });
    } catch (logErr) {
      console.warn("[generate-facultades] Audit log failed:", logErr);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[generate-facultades] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Parse the AI output into structured response.
 */
function parseAIOutput(
  rawContent: string,
  contextParts: string[],
): {
  draftText: string | null;
  assumptions: string[];
  followUpQuestion: string | null;
} {
  const trimmed = rawContent.trim();

  // Check if AI is asking a follow-up question
  if (trimmed.startsWith("PREGUNTA:")) {
    return {
      draftText: null,
      assumptions: [],
      followUpQuestion: trimmed.replace(/^PREGUNTA:\s*/i, "").trim(),
    };
  }

  // Extract facultades
  let draftText = trimmed;
  if (trimmed.includes("FACULTADES:")) {
    draftText = trimmed.split("FACULTADES:")[1]?.trim() || trimmed;
  }

  // Clean up any markdown formatting
  draftText = draftText
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .trim();

  // Enforce max length
  if (draftText.length > 2000) {
    draftText = draftText.slice(0, 2000);
    // Try to cut at last complete numbered item
    const lastNewline = draftText.lastIndexOf("\n");
    if (lastNewline > 1500) {
      draftText = draftText.slice(0, lastNewline);
    }
  }

  // Infer assumptions
  const assumptions: string[] = [];
  const hasProcessType = contextParts.some(p => p.startsWith("TIPO DE PROCESO:") && !p.includes("No especificado") && !p.includes("UNKNOWN"));
  const hasObject = contextParts.some(p => p.startsWith("OBJETO DEL PODER"));
  
  if (!hasProcessType) assumptions.push("Tipo de proceso no especificado — se generaron facultades de uso general.");
  if (!hasObject) assumptions.push("Objeto del poder no especificado — las facultades son genéricas.");

  return {
    draftText,
    assumptions,
    followUpQuestion: null,
  };
}
