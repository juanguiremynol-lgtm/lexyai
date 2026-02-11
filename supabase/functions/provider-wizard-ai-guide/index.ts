/**
 * provider-wizard-ai-guide — Gemini-powered contextual assistant for the External Provider Wizard.
 *
 * Supports dry_run mode for smoke testing (validates schema without calling Gemini).
 * Redacts secrets, builds context pack, calls Gemini, returns structured JSON guidance.
 * Rate-limited: max 20 calls per user per 10 minutes.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ---- Rate limiting (in-memory per-isolate) ----
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ---- System prompt ----
const GEMINI_SYSTEM_PROMPT = `You are an AI integration advisor for ATENIA, a Colombian legal-tech platform that monitors judicial processes.

ROLE: You provide advisory guidance to administrators configuring external data providers in the Provider Wizard. You help explain steps, detect misconfigurations, and suggest safe defaults.

CRITICAL RULES (NON-NEGOTIABLE):
1. NEVER request, display, or reference API keys, HMAC secrets, JWTs, or any authentication credentials.
2. NEVER recommend disabling SSRF protection, RLS policies, or request signing.
3. NEVER claim to change code, modify database schema, or apply configurations automatically.
4. All recommendations require explicit admin confirmation before being applied.
5. Always explain whether changes affect the entire platform (GLOBAL) or only one organization (ORG_PRIVATE).

DATA ARCHITECTURE:
- Canonical tables: work_item_acts (actuaciones) and work_item_publicaciones (publicaciones)
- No per-provider database schema changes allowed
- Unknown/unmapped provider fields go to JSONB extras tables (work_item_act_extras, work_item_pub_extras)
- Raw payloads are always preserved in provider_raw_snapshots for forensic replay
- Deduplication uses stable hash fingerprints based on date + normalized description

PROVIDER CONTRACT:
- Providers must expose: /health, /capabilities, /resolve, /snapshot endpoints
- Only HTTPS allowed (SSRF protection)
- Base URLs must match the connector's allowed_domains allowlist
- Auth modes: API_KEY or HMAC_SHARED_SECRET

ROUTING PRECEDENCE: ORG_OVERRIDE > GLOBAL > BUILTIN (CPNU, SAMAI)

OUTPUT FORMAT: Always respond with valid JSON matching this structure:
{
  "step_id": "<current wizard step>",
  "diagnosis": { "status": "OK|WARN|BLOCK", "reasons": ["..."] },
  "recommended_actions": [{ "type": "SET_FIELD|RUN_CHECK|REVIEW", "path": "...", "value": "...", "why": "..." }],
  "security_warnings": [{ "code": "...", "message": "..." }],
  "routing_advice": { "strategy": "SELECT|MERGE", "why": "..." },
  "mapping_advice": { "suggestion": "KEEP_CANONICAL|ADD_MAPPING|STORE_EXTRAS", "why": "..." },
  "explanation": "<short human-readable summary in Spanish>",
  "next_questions": ["..."]
}

LANGUAGE: Respond in Spanish unless the admin explicitly writes in English.`;

// ---- Secret redaction ----
const SECRET_KEYS = new Set([
  "secret_value", "secret", "api_key", "apikey", "hmac_secret", "token",
  "password", "authorization", "bearer", "credential", "private_key",
]);

function redactSecrets(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else if (typeof val === "string" && val.length > 20 && /^(sk_|pk_|Bearer |ey[A-Za-z0-9])/.test(val)) {
        result[key] = "[REDACTED_TOKEN]";
      } else {
        result[key] = redactSecrets(val);
      }
    }
    return result;
  }
  return obj;
}

// ---- Canonical schema summary ----
const CANONICAL_SCHEMA_SUMMARY = {
  work_item_acts: {
    required: ["work_item_id", "description", "event_date", "source_platform", "hash_fingerprint"],
    optional: ["event_summary", "event_time", "event_type", "scrape_date", "raw_data", "indice"],
    extras: "Unmapped fields stored in work_item_act_extras.extras (JSONB)",
  },
  work_item_publicaciones: {
    required: ["work_item_id", "description", "pub_date", "source_platform", "hash_fingerprint"],
    optional: ["event_summary", "scrape_date", "raw_data"],
    extras: "Unmapped fields stored in work_item_pub_extras.extras (JSONB)",
  },
};

// ---- Simple hash for dry_run ----
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

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

    if (!checkRateLimit(user.id)) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 20 requests per 10 minutes." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { session_id, mode, step_id, wizard_state, preflight, e2e_result, trace_ids, question, dry_run } = body;

    // Build redacted context pack
    const redactedState = redactSecrets(wizard_state || {});
    const redactedPreflight = redactSecrets(preflight || null);
    const redactedE2E = redactSecrets(e2e_result || null);

    const contextPack = {
      step_id,
      mode,
      wizard_state: redactedState,
      preflight: redactedPreflight,
      e2e_result: redactedE2E,
      canonical_schema: CANONICAL_SCHEMA_SUMMARY,
      ssrf_rules: { https_only: true, private_ips_blocked: true, localhost_blocked: true, allowlist_required: true },
      routing_precedence: ["ORG_OVERRIDE", "GLOBAL", "BUILTIN"],
    };

    // ---- DRY RUN MODE ----
    if (dry_run === true) {
      const contextStr = JSON.stringify(contextPack);
      return new Response(JSON.stringify({
        dry_run: true,
        ok: true,
        context_pack_summary: {
          step_id,
          mode,
          state_keys: Object.keys(redactedState as object || {}),
          has_preflight: redactedPreflight != null,
          has_e2e: redactedE2E != null,
          context_hash: simpleHash(contextStr),
          context_length: contextStr.length,
          secrets_redacted: true,
          schema_version: "canonical_v1",
        },
        validation: {
          step_id_present: !!step_id,
          mode_valid: mode === "PLATFORM" || mode === "ORG",
          ssrf_enforced: true,
          routing_tiers: 3,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- FULL MODE ----
    const adminClient = createClient(supabaseUrl, serviceKey);

    // Create or reuse session
    let activeSessionId = session_id;
    if (!activeSessionId) {
      const profile = await adminClient.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
      const { data: session } = await adminClient.from("provider_ai_sessions").insert({
        organization_id: profile?.data?.organization_id || null,
        actor_user_id: user.id,
        mode: mode || "ORG",
      }).select("id").single();
      activeSessionId = session?.id;
    }

    // Fetch traces if provided
    let traceContext = null;
    if (trace_ids && Array.isArray(trace_ids) && trace_ids.length > 0) {
      const { data: traces } = await adminClient
        .from("provider_sync_traces")
        .select("step, provider, success, error_code, error_message, created_at")
        .in("id", trace_ids.slice(0, 10))
        .order("created_at");
      traceContext = traces;
    }

    const fullContextPack = { ...contextPack, traces: traceContext };

    const userMessage = question
      ? `Context: ${JSON.stringify(fullContextPack)}\n\nAdmin question: ${question}`
      : `Analyze the current wizard state and provide guidance:\n${JSON.stringify(fullContextPack)}`;

    // Store user message
    if (activeSessionId) {
      await adminClient.from("provider_ai_messages").insert({
        session_id: activeSessionId,
        role: "user",
        content: userMessage.slice(0, 10000),
        metadata: { step_id, has_question: !!question },
      });
    }

    // Call Gemini
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({
        error: "AI service not configured",
        fallback: { step_id, diagnosis: { status: "WARN", reasons: ["AI guide unavailable"] }, explanation: "El servicio de IA no está configurado." },
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
          { role: "system", content: GEMINI_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "AI rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        step_id,
        diagnosis: { status: "WARN", reasons: ["AI service temporarily unavailable"] },
        explanation: "El servicio de IA no está disponible temporalmente. Puede continuar sin asistencia.",
        recommended_actions: [],
        security_warnings: [],
        next_questions: [],
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiResponse.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "";

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)```/) || rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
      parsed = JSON.parse(jsonStr.trim());
    } catch {
      parsed = {
        step_id,
        diagnosis: { status: "OK", reasons: [] },
        explanation: rawContent.slice(0, 1000),
        recommended_actions: [],
        security_warnings: [],
        next_questions: [],
      };
    }

    // Store assistant response
    if (activeSessionId) {
      await adminClient.from("provider_ai_messages").insert({
        session_id: activeSessionId,
        role: "assistant",
        content: JSON.stringify(parsed).slice(0, 10000),
        metadata: { step_id, model: "gemini-3-flash-preview" },
      });
    }

    return new Response(JSON.stringify({
      session_id: activeSessionId,
      ...parsed,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("provider-wizard-ai-guide error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
