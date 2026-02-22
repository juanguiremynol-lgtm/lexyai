import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ).auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hearing_id, organization_id } = await req.json();
    if (!hearing_id || !organization_id) {
      return new Response(JSON.stringify({ error: "hearing_id and organization_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check org membership
    const { data: member } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: "Not a member of this organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check tenant AI enabled
    const { data: tenantConfig } = await supabase
      .from("hearing_tenant_config")
      .select("ai_insights_enabled")
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!tenantConfig?.ai_insights_enabled) {
      return new Response(JSON.stringify({ error: "AI insights not enabled for this organization" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check user AI pref
    const { data: userPref } = await supabase
      .from("hearing_user_ai_prefs")
      .select("ai_enabled")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (!userPref?.ai_enabled) {
      return new Response(JSON.stringify({ error: "User has not enabled AI for hearings" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load hearing
    const { data: hearing, error: hearingError } = await supabase
      .from("work_item_hearings")
      .select("*, hearing_types(name, short_name, jurisdiction, legal_basis)")
      .eq("id", hearing_id)
      .eq("organization_id", organization_id)
      .single();

    if (hearingError || !hearing) {
      return new Response(JSON.stringify({ error: "Hearing not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load artifacts text
    const { data: artifacts } = await supabase
      .from("hearing_artifacts")
      .select("title, extracted_text, kind")
      .eq("work_item_hearing_id", hearing_id);

    const artifactText = (artifacts || [])
      .filter((a: any) => a.extracted_text)
      .map((a: any) => `[${a.kind}] ${a.title || ""}: ${a.extracted_text}`)
      .join("\n\n");

    // Build context
    const hearingType = (hearing as any).hearing_types;
    const jurisdiction = hearingType?.jurisdiction || "Desconocida";
    const hearingTypeName = hearingType?.short_name || hearing.custom_name || "Audiencia";
    const occurredAt = hearing.occurred_at || hearing.scheduled_at || "Sin fecha";
    const participantCount = (hearing.participants || []).length;

    const notesContent = [
      hearing.decisions_summary ? `DECISIONES:\n${hearing.decisions_summary}` : "",
      hearing.notes_plain_text ? `NOTAS:\n${hearing.notes_plain_text}` : "",
      (hearing.key_moments || []).length > 0
        ? `MOMENTOS CLAVE:\n${(hearing.key_moments as any[]).map((km: any) => `- [${km.type}] ${km.text}`).join("\n")}`
        : "",
      artifactText ? `TEXTO DE ARCHIVOS:\n${artifactText}` : "",
    ].filter(Boolean).join("\n\n");

    if (!notesContent.trim()) {
      return new Response(JSON.stringify({ error: "No hay contenido suficiente para analizar" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are Atenia AI, a legal assistant for Colombian litigators.
You are analyzing notes and transcripts from a court hearing.

Context:
- Jurisdiction: ${jurisdiction}
- Hearing type: ${hearingTypeName}
- Date: ${occurredAt}
- Participants: ${participantCount} (details in notes)

Your task is to analyze the hearing content and provide:
1. gaps_to_verify: Facts or statements that seem incomplete, contradictory, or need verification
2. points_of_interest: Notable legal or factual points the lawyer should consider
3. follow_up_questions: Questions the lawyer might want to investigate or ask in future hearings
4. suggested_prompt_template: A reusable prompt the lawyer can use to further analyze this hearing's content

CRITICAL RULES:
- Do NOT provide legal advice or conclusions
- Do NOT invent facts not present in the input
- Do NOT cite jurisprudence unless explicitly present in the notes
- Respond in Spanish (Colombian legal Spanish)
- Be specific — reference actual content from the notes
- Mark each item with a confidence level (alta/media/baja)

Respond ONLY with valid JSON matching this schema:
{
  "gaps_to_verify": [{"text": "...", "confidence": "alta|media|baja", "source": "notes|transcript"}],
  "points_of_interest": [{"text": "...", "confidence": "alta|media|baja", "relevance": "..."}],
  "follow_up_questions": [{"question": "...", "rationale": "..."}],
  "suggested_prompt_template": "..."
}`;

    // Call Lovable AI Gateway
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: notesContent },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Límite de solicitudes excedido. Intente más tarde." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA insuficientes." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Error del servicio de IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const jsonStr = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = {
        gaps_to_verify: [],
        points_of_interest: [],
        follow_up_questions: [],
        suggested_prompt_template: rawContent,
      };
    }

    // Store insight
    const { data: insight, error: insertError } = await supabase
      .from("hearing_ai_insights")
      .insert({
        organization_id,
        work_item_hearing_id: hearing_id,
        authorized_by: user.id,
        input_summary: {
          hearing_type: hearingTypeName,
          jurisdiction,
          dates: occurredAt,
          participant_count: participantCount,
          text_length: notesContent.length,
        },
        model_id: "google/gemini-3-flash-preview",
        gaps_to_verify: parsed.gaps_to_verify || [],
        points_of_interest: parsed.points_of_interest || [],
        follow_up_questions: parsed.follow_up_questions || [],
        suggested_prompt_template: parsed.suggested_prompt_template || null,
        raw_response: aiData,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Error storing insight:", insertError);
    }

    // Audit log
    await supabase.from("hearing_audit_log").insert({
      organization_id,
      user_id: user.id,
      action: "ai_insight_generated",
      work_item_hearing_id: hearing_id,
      detail: { insight_id: insight?.id, model: "google/gemini-3-flash-preview" },
    });

    return new Response(JSON.stringify({
      id: insight?.id,
      gaps_to_verify: parsed.gaps_to_verify || [],
      points_of_interest: parsed.points_of_interest || [],
      follow_up_questions: parsed.follow_up_questions || [],
      suggested_prompt_template: parsed.suggested_prompt_template || "",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("hearing-ai-insights error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
