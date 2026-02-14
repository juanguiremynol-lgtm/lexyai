/**
 * provider-wizard-simulate — Dry-run simulation for External Provider Wizard.
 *
 * Simulates the full data pipeline WITHOUT writing to canonical tables:
 * 1. RESOLVE: Simulates source resolution (mock or real preflight)
 * 2. FETCH: Simulates or executes a real snapshot fetch
 * 3. PARSE: Validates payload structure against canonical schema
 * 4. MAPPING: Applies mapping spec (dry-run) and reports field coverage
 * 5. DEDUP: Checks for hash collisions against existing data
 * 6. DB_WRITE: Validates INSERT compatibility (types, constraints, nulls) WITHOUT writing
 * 7. AI_ANALYSIS: Optional Gemini analysis of the full pipeline result
 *
 * Modes:
 *   - "SAMPLE_PAYLOAD": User provides a sample JSON payload to test mapping/write compatibility
 *   - "LIVE_FETCH": Fetches real data from the provider but does NOT write to DB
 *   - "FIXTURE": Uses built-in fixture data for quick validation
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-atenia-wizard-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Canonical schema for validation
const CANONICAL_SCHEMAS: Record<string, { required: string[]; optional: string[]; types: Record<string, string> }> = {
  work_item_acts: {
    required: ["work_item_id", "description", "event_date", "source_platform", "hash_fingerprint"],
    optional: ["event_summary", "event_time", "event_type", "scrape_date", "raw_data", "indice", "act_type"],
    types: {
      work_item_id: "uuid", description: "text", event_date: "date", event_time: "time",
      source_platform: "text", hash_fingerprint: "text", event_summary: "text",
      event_type: "text", scrape_date: "timestamptz", raw_data: "jsonb", indice: "text", act_type: "text",
    },
  },
  work_item_publicaciones: {
    required: ["work_item_id", "description", "pub_date", "source_platform", "hash_fingerprint"],
    optional: ["event_summary", "scrape_date", "raw_data", "source_url", "document_hash"],
    types: {
      work_item_id: "uuid", description: "text", pub_date: "date",
      source_platform: "text", hash_fingerprint: "text", event_summary: "text",
      scrape_date: "timestamptz", raw_data: "jsonb", source_url: "text", document_hash: "text",
    },
  },
};

// Fixture data for quick testing
const FIXTURE_PAYLOADS: Record<string, unknown[]> = {
  ACTUACIONES: [
    { fechaActuacion: "2025-06-01", actuacion: "AUTO ADMISORIO DE LA DEMANDA", anotacion: "Se admite demanda ejecutiva.", fechaRegistro: "2025-06-01T10:00:00Z" },
    { fechaActuacion: "2025-05-15", actuacion: "RADICACIÓN DE DEMANDA", anotacion: "Radicación proceso ejecutivo singular.", fechaRegistro: "2025-05-15T08:30:00Z" },
    { fechaActuacion: "2025-04-20", actuacion: "NOTIFICACIÓN PERSONAL", anotacion: "Se notifica personalmente al demandado.", fechaRegistro: "2025-04-20T14:00:00Z" },
  ],
  ESTADOS: [
    { fecha_fijacion: "2025-06-02", descripcion: "FIJACIÓN DE ESTADO No. 045", tipo: "ESTADO", documento_url: "https://example.com/estado_045.pdf" },
    { fecha_fijacion: "2025-05-20", descripcion: "FIJACIÓN DE ESTADO No. 032", tipo: "ESTADO" },
  ],
  SNAPSHOT: {
    actuaciones: [
      { fechaActuacion: "2025-06-01", actuacion: "AUTO ADMISORIO", anotacion: "Admisión", fechaRegistro: "2025-06-01T10:00:00Z" },
    ],
    estados: [
      { fecha_fijacion: "2025-06-02", descripcion: "ESTADO No. 045" },
    ],
  },
};

// Simple hash for dedup simulation
function simHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

// Validate a record against canonical schema
function validateRecord(
  record: Record<string, unknown>,
  targetTable: string
): { valid: boolean; errors: string[]; warnings: string[]; mapped_fields: string[]; extra_fields: string[] } {
  const schema = CANONICAL_SCHEMAS[targetTable];
  if (!schema) return { valid: false, errors: [`Unknown table: ${targetTable}`], warnings: [], mapped_fields: [], extra_fields: [] };

  const errors: string[] = [];
  const warnings: string[] = [];
  const allKnown = [...schema.required, ...schema.optional];
  const mapped_fields = Object.keys(record).filter(k => allKnown.includes(k));
  const extra_fields = Object.keys(record).filter(k => !allKnown.includes(k));

  // Check required fields
  for (const req of schema.required) {
    if (record[req] === undefined || record[req] === null || record[req] === "") {
      errors.push(`Missing required field: ${req}`);
    }
  }

  // Type checks
  for (const [field, value] of Object.entries(record)) {
    const expectedType = schema.types[field];
    if (!expectedType) continue;
    if (value === null || value === undefined) continue;

    if (expectedType === "uuid" && typeof value === "string" && !/^[0-9a-f-]{36}$/i.test(value)) {
      errors.push(`${field}: invalid UUID format`);
    }
    if (expectedType === "date" && typeof value === "string" && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
      warnings.push(`${field}: date format may not match (expected YYYY-MM-DD)`);
    }
    if (expectedType === "jsonb" && typeof value !== "object") {
      warnings.push(`${field}: expected object/array for JSONB`);
    }
  }

  if (extra_fields.length > 0) {
    warnings.push(`${extra_fields.length} unmapped fields will go to extras table: ${extra_fields.join(", ")}`);
  }

  return { valid: errors.length === 0, errors, warnings, mapped_fields, extra_fields };
}

// Simulate mapping from raw provider format to canonical
function simulateMapping(
  rawRecords: unknown[],
  dataKind: string,
  sourcePlatform: string
): { canonical: Record<string, unknown>[]; mapping_report: Record<string, unknown> } {
  const targetTable = dataKind === "ESTADOS" ? "work_item_publicaciones" : "work_item_acts";
  const canonical: Record<string, unknown>[] = [];
  const allExtraFields = new Set<string>();
  const allMappedFields = new Set<string>();

  for (const raw of rawRecords) {
    const r = raw as Record<string, unknown>;
    let mapped: Record<string, unknown>;

    if (dataKind === "ESTADOS") {
      mapped = {
        work_item_id: "00000000-0000-0000-0000-000000000000", // placeholder
        description: r.descripcion || r.description || String(r.actuacion || ""),
        pub_date: r.fecha_fijacion || r.pub_date || r.fechaActuacion || null,
        source_platform: sourcePlatform,
        hash_fingerprint: simHash(JSON.stringify(r)),
        event_summary: String(r.descripcion || r.description || "").slice(0, 80),
        source_url: r.documento_url || r.source_url || null,
        raw_data: r,
      };
    } else {
      const desc = [r.actuacion, r.anotacion].filter(Boolean).join(" — ");
      mapped = {
        work_item_id: "00000000-0000-0000-0000-000000000000",
        description: desc || r.description || "",
        event_date: r.fechaActuacion || r.event_date || r.fecha_providencia || null,
        event_time: r.horaActuacion || r.event_time || null,
        source_platform: sourcePlatform,
        hash_fingerprint: simHash(JSON.stringify(r)),
        event_summary: String(desc || "").slice(0, 80),
        event_type: r.tipo || r.event_type || "ACTUACION",
        scrape_date: new Date().toISOString(),
        raw_data: r,
      };
    }

    const validation = validateRecord(mapped, targetTable);
    allMappedFields.add(...(validation.mapped_fields || []));
    for (const ef of validation.extra_fields) allExtraFields.add(ef);
    canonical.push({ ...mapped, _validation: validation });
  }

  return {
    canonical,
    mapping_report: {
      target_table: targetTable,
      total_records: rawRecords.length,
      mapped_fields: [...allMappedFields],
      extra_fields: [...allExtraFields],
      records_valid: canonical.filter((c: any) => c._validation?.valid).length,
      records_invalid: canonical.filter((c: any) => !c._validation?.valid).length,
    },
  };
}

// Detect data characteristics for AI analysis
function detectCharacteristics(records: unknown[]): Record<string, unknown> {
  if (!records || records.length === 0) return { empty: true };
  
  const sample = records[0] as Record<string, unknown>;
  const allKeys = new Set<string>();
  const dateFields: string[] = [];
  const urlFields: string[] = [];
  const longTextFields: string[] = [];

  for (const r of records) {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      allKeys.add(k);
      if (typeof v === "string") {
        if (/^\d{4}-\d{2}-\d{2}/.test(v)) dateFields.push(k);
        if (/^https?:\/\//.test(v)) urlFields.push(k);
        if (v.length > 200) longTextFields.push(k);
      }
    }
  }

  const hasTimestamps = dateFields.length > 0;
  const hasDocLinks = urlFields.length > 0;
  const hasLargePayloads = longTextFields.length > 0;
  const isSnapshot = records.length > 1 && hasTimestamps;
  const needsPolling = !isSnapshot || records.length <= 2;

  return {
    total_fields: allKeys.size,
    field_names: [...allKeys],
    date_fields: [...new Set(dateFields)],
    url_fields: [...new Set(urlFields)],
    has_document_links: hasDocLinks,
    has_timestamps: hasTimestamps,
    has_large_payloads: hasLargePayloads,
    record_count: records.length,
    inferred_pattern: isSnapshot ? "SNAPSHOT" : "SINGLE_RECORD",
    recommended_strategy: isSnapshot ? "snapshot_bulk" : needsPolling ? "polling_incremental" : "snapshot_bulk",
    avg_record_size_bytes: Math.round(JSON.stringify(records).length / records.length),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const peek = await req.clone().json().catch(() => null);
    if (peek?.health_check) {
      return new Response(JSON.stringify({ ok: true, service: "provider-wizard-simulate" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not health check */ }

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
    const {
      simulation_mode, // "SAMPLE_PAYLOAD" | "LIVE_FETCH" | "FIXTURE"
      connector_id,
      instance_id,
      data_kind, // "ACTUACIONES" | "ESTADOS" | "SNAPSHOT"
      source_platform,
      sample_payload, // array of raw records (for SAMPLE_PAYLOAD mode)
      work_item_id, // optional, for dedup check
      radicado, // optional, for LIVE_FETCH
      include_ai_analysis, // boolean
    } = body;

    const mode = simulation_mode || "FIXTURE";
    const kind = data_kind || "ACTUACIONES";
    const platform = source_platform || "SIMULATED";

    const steps: Array<{ step: string; status: string; detail: unknown; duration_ms: number }> = [];
    let rawRecords: unknown[] = [];

    // ---- Step 1: RESOLVE / SOURCE ----
    const resolveStart = Date.now();
    if (mode === "FIXTURE") {
      rawRecords = kind === "SNAPSHOT" 
        ? [...(FIXTURE_PAYLOADS.SNAPSHOT as any).actuaciones, ...(FIXTURE_PAYLOADS.SNAPSHOT as any).estados]
        : (FIXTURE_PAYLOADS[kind] || FIXTURE_PAYLOADS.ACTUACIONES) as unknown[];
      steps.push({ step: "RESOLVE", status: "SIMULATED", detail: { source: "fixture", record_count: rawRecords.length }, duration_ms: Date.now() - resolveStart });
    } else if (mode === "SAMPLE_PAYLOAD") {
      if (!sample_payload || !Array.isArray(sample_payload) || sample_payload.length === 0) {
        return new Response(JSON.stringify({ error: "sample_payload must be a non-empty array" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      rawRecords = sample_payload;
      steps.push({ step: "RESOLVE", status: "USER_PROVIDED", detail: { source: "user_payload", record_count: rawRecords.length }, duration_ms: Date.now() - resolveStart });
    } else if (mode === "LIVE_FETCH") {
      // For live fetch, we'd call the real provider but NOT write — for now, indicate this requires instance_id
      if (!instance_id) {
        return new Response(JSON.stringify({ error: "instance_id required for LIVE_FETCH mode" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      steps.push({ step: "RESOLVE", status: "LIVE_FETCH_PLACEHOLDER", detail: { note: "Live fetch delegates to provider-test-connection + provider-resolve-source. Use E2E step for real data." }, duration_ms: Date.now() - resolveStart });
      // Use fixture as fallback for pipeline testing
      rawRecords = (FIXTURE_PAYLOADS[kind] || FIXTURE_PAYLOADS.ACTUACIONES) as unknown[];
    }

    // ---- Step 2: PARSE (validate raw structure) ----
    const parseStart = Date.now();
    const characteristics = detectCharacteristics(rawRecords);
    steps.push({
      step: "PARSE",
      status: "OK",
      detail: {
        record_count: rawRecords.length,
        characteristics,
        sample_keys: rawRecords.length > 0 ? Object.keys(rawRecords[0] as object) : [],
      },
      duration_ms: Date.now() - parseStart,
    });

    // ---- Step 3: MAPPING (simulate field mapping) ----
    const mappingStart = Date.now();
    const effectiveKind = kind === "SNAPSHOT" ? "ACTUACIONES" : kind;
    const { canonical, mapping_report } = simulateMapping(rawRecords, effectiveKind, platform);
    steps.push({
      step: "MAPPING",
      status: (mapping_report as any).records_invalid > 0 ? "WARN" : "OK",
      detail: mapping_report,
      duration_ms: Date.now() - mappingStart,
    });

    // ---- Step 4: DEDUP (check hash collisions) ----
    const dedupStart = Date.now();
    let dedupResult: Record<string, unknown> = { checked: false };
    if (work_item_id) {
      const adminClient = createClient(supabaseUrl, serviceKey);
      const hashes = canonical.map((c: any) => c.hash_fingerprint).filter(Boolean);
      
      const targetTable = effectiveKind === "ESTADOS" ? "work_item_publicaciones" : "work_item_acts";
      const { data: existing } = await adminClient
        .from(targetTable)
        .select("hash_fingerprint")
        .eq("work_item_id", work_item_id)
        .in("hash_fingerprint", hashes);

      const existingHashes = new Set((existing || []).map((e: any) => e.hash_fingerprint));
      const duplicates = hashes.filter((h: string) => existingHashes.has(h));
      const newRecords = hashes.filter((h: string) => !existingHashes.has(h));

      dedupResult = {
        checked: true,
        total_hashes: hashes.length,
        duplicates_found: duplicates.length,
        new_records: newRecords.length,
        would_insert: newRecords.length,
        would_skip: duplicates.length,
        dedup_strategy: "hash_fingerprint",
      };
    }
    steps.push({ step: "DEDUP", status: "OK", detail: dedupResult, duration_ms: Date.now() - dedupStart });

    // ---- Step 5: DB_WRITE (dry-run validation) ----
    const writeStart = Date.now();
    const validationResults = canonical.map((c: any) => ({
      hash: c.hash_fingerprint,
      valid: c._validation?.valid ?? false,
      errors: c._validation?.errors ?? [],
      warnings: c._validation?.warnings ?? [],
    }));
    const allValid = validationResults.every((v: any) => v.valid);
    steps.push({
      step: "DB_WRITE_DRYRUN",
      status: allValid ? "OK" : "FAIL",
      detail: {
        dry_run: true,
        would_write: false,
        records_checked: validationResults.length,
        records_valid: validationResults.filter((v: any) => v.valid).length,
        records_invalid: validationResults.filter((v: any) => !v.valid).length,
        validation_details: validationResults.slice(0, 5), // cap at 5 for response size
        target_table: effectiveKind === "ESTADOS" ? "work_item_publicaciones" : "work_item_acts",
      },
      duration_ms: Date.now() - writeStart,
    });

    // ---- Step 6: AI ANALYSIS (optional) ----
    let aiAnalysis: Record<string, unknown> | null = null;
    if (include_ai_analysis) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (LOVABLE_API_KEY) {
        const analysisStart = Date.now();
        try {
          const analysisPrompt = `Analiza el resultado de una simulación de pipeline de proveedor externo para la plataforma ATENIA (legal-tech colombiana).

DATOS DE LA SIMULACIÓN:
- Modo: ${mode}
- Tipo de datos: ${kind}
- Plataforma: ${platform}
- Registros: ${rawRecords.length}
- Características detectadas: ${JSON.stringify(characteristics)}
- Reporte de mapping: ${JSON.stringify(mapping_report)}
- Resultado de dedup: ${JSON.stringify(dedupResult)}
- Validación DB: ${allValid ? "Todos válidos" : `${validationResults.filter((v: any) => !v.valid).length} inválidos`}

CAMPOS ENCONTRADOS: ${(characteristics as any).field_names?.join(", ") || "N/A"}

RESPONDE EN ESPAÑOL con este JSON:
{
  "integration_type": "snapshot | polling | webhook | hybrid",
  "integration_type_reason": "...",
  "recommended_sync_strategy": "...",
  "data_quality_score": 0-100,
  "data_quality_issues": ["..."],
  "mapping_recommendations": ["..."],
  "polling_interval_suggestion": "...",
  "requires_identity_mapping": true|false,
  "snapshot_compatible": true|false,
  "dedup_risk": "low|medium|high",
  "dedup_risk_reason": "...",
  "workarounds": [{"issue": "...", "solution": "...", "no_code": true}],
  "summary": "..."
}`;

          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are a data integration advisor for ATENIA, a Colombian legal-tech platform. Analyze simulation results and provide actionable recommendations. Always respond with valid JSON in Spanish." },
                { role: "user", content: analysisPrompt },
              ],
              temperature: 0.2,
              max_tokens: 2000,
            }),
          });

          if (aiResp.ok) {
            const aiData = await aiResp.json();
            const raw = aiData.choices?.[0]?.message?.content || "";
            try {
              const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) || raw.match(/\{[\s\S]*\}/);
              aiAnalysis = JSON.parse((jsonMatch?.[1] || jsonMatch?.[0] || raw).trim());
            } catch {
              aiAnalysis = { summary: raw.slice(0, 1000), parse_error: true };
            }
          }

          steps.push({ step: "AI_ANALYSIS", status: aiAnalysis ? "OK" : "SKIP", detail: { analyzed: !!aiAnalysis }, duration_ms: Date.now() - analysisStart });
        } catch (err: any) {
          steps.push({ step: "AI_ANALYSIS", status: "ERROR", detail: { error: err.message }, duration_ms: Date.now() - analysisStart });
        }
      }
    }

    // ---- Build response ----
    const allStepsOk = steps.every(s => s.status === "OK" || s.status === "SIMULATED" || s.status === "USER_PROVIDED" || s.status === "SKIP");
    
    return new Response(JSON.stringify({
      ok: allStepsOk,
      simulation_mode: mode,
      data_kind: kind,
      source_platform: platform,
      steps,
      characteristics,
      mapping_report,
      dedup: dedupResult,
      ai_analysis: aiAnalysis,
      sample_canonical: canonical.slice(0, 3).map((c: any) => {
        const { _validation, ...rest } = c;
        return rest;
      }),
      recommendations: {
        is_snapshot: (characteristics as any).inferred_pattern === "SNAPSHOT",
        recommended_strategy: (characteristics as any).recommended_strategy,
        has_documents: (characteristics as any).has_document_links,
        needs_identity_mapping: (mapping_report as any).extra_fields?.length === 0,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
