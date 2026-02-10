/**
 * provider-infer-mapping — Gemini-assisted mapping inference from sample payloads.
 *
 * Takes a raw snapshot ID and proposes a mapping spec that the admin must explicitly approve.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAPPING_INFERENCE_PROMPT = `You are a data mapping specialist for ATENIA, a Colombian legal-tech platform.

Given a sample JSON payload from an external judicial data provider, propose a deterministic mapping specification that transforms the payload into ATENIA's canonical schema.

CANONICAL SCHEMA (target):
Acts (work_item_acts):
- event_date (date, REQUIRED): Date of the judicial action
- event_time (text): Time of the action
- event_type (text): Normalized type (uppercase, underscored)
- description (text, REQUIRED): Full description of the action
- event_summary (text): Truncated preview for UI
- provider_event_id (text): Provider's unique ID for this record
- indice (text): Index/sequence number

Pubs (work_item_publicaciones):
- pub_date (date, REQUIRED): Publication date
- description (text, REQUIRED): Publication description
- event_summary (text): Truncated preview
- provider_event_id (text): Provider's unique ID

AVAILABLE TRANSFORMS (allowlisted only):
STRING, TRIM, NUMBER, BOOLEAN, DATE_ISO, DATE_CO, DATETIME_ISO, NORMALIZE_TYPE, IDENTITY

RULES:
1. Only use the transforms listed above. No arbitrary code.
2. Map to canonical fields only. All unmapped source fields go to extras.
3. Set extras_mode to "STORE_UNMAPPED" to preserve unknown fields.
4. Use JSON path notation ($.field.subfield).
5. Mark required canonical fields with "required": true.
6. Never propose creating new database columns.

OUTPUT: Return ONLY valid JSON matching this structure:
{
  "acts": {
    "array_path": "$.actuaciones",
    "fields": {
      "event_date": { "path": "$.fecha", "transform": "DATE_ISO", "required": true },
      ...
    },
    "extras_mode": "STORE_UNMAPPED"
  },
  "pubs": { ... },
  "confidence": { "event_date": 0.95, "description": 0.9, ... },
  "rationale": "Short explanation of mapping decisions"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { sample_payload_id, provider_connector_id, schema_version, scope } = body;

    if (!sample_payload_id) {
      return new Response(JSON.stringify({ error: "sample_payload_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Fetch the raw snapshot
    const { data: snapshot, error: snapErr } = await adminClient
      .from("provider_raw_snapshots")
      .select("payload, scope, provider_instance_id")
      .eq("id", sample_payload_id)
      .single();

    if (snapErr || !snapshot) {
      return new Response(JSON.stringify({ error: "Snapshot not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Truncate payload for Gemini (max ~8k chars)
    const payloadStr = JSON.stringify(snapshot.payload).slice(0, 8000);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          { role: "system", content: MAPPING_INFERENCE_PROMPT },
          { role: "user", content: `Analyze this provider payload and propose a mapping spec:\n\nScope: ${scope || snapshot.scope}\nSchema version: ${schema_version || "v1"}\n\nPayload sample:\n${payloadStr}` },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let proposedSpec: Record<string, unknown>;
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
      proposedSpec = JSON.parse(jsonStr.trim());
    } catch {
      return new Response(JSON.stringify({
        error: "Failed to parse AI mapping proposal",
        raw_response: rawContent.slice(0, 2000),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      ok: true,
      proposed_spec: proposedSpec,
      provider_connector_id,
      schema_version: schema_version || "v1",
      scope: scope || snapshot.scope,
      requires_admin_approval: true,
      message: "This mapping spec is a PROPOSAL. Review and approve before saving as ACTIVE.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
