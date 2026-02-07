/**
 * Atenia AI Supervisor — Post-Sync Analysis & Diagnostics
 *
 * Runs AFTER scheduled-daily-sync to audit results, diagnose failures,
 * trigger remediation, and prepare Lexy daily message data.
 *
 * Modes:
 *   POST_DAILY_SYNC  — Full audit after daily cron
 *   POST_LOGIN_SYNC  — Lightweight audit after login sync
 *   MANUAL_AUDIT     — On-demand by super admin
 *   HEALTH_CHECK     — Quick provider connectivity check
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ────────────────────────────────────────────────────────────

interface AteniaAIInput {
  mode: "POST_DAILY_SYNC" | "POST_LOGIN_SYNC" | "MANUAL_AUDIT" | "HEALTH_CHECK";
  organization_id?: string;
  run_date?: string; // YYYY-MM-DD, defaults to today COT
}

interface DiagnosticEntry {
  work_item_id: string;
  radicado: string;
  severity: "OK" | "AVISO" | "PROBLEMA" | "CRITICO";
  category: string;
  message_es: string;
  technical_detail: string;
  suggested_action?: string;
  auto_remediated?: boolean;
}

interface ProviderHealth {
  status: "healthy" | "degraded" | "down" | "unknown";
  avg_latency_ms: number;
  errors: number;
  total_calls: number;
  error_pattern?: string;
}

interface RemediationAction {
  action: string;
  work_item_id?: string;
  reason: string;
  result?: string;
}

interface SyncTrace {
  id: string;
  trace_id: string;
  work_item_id: string | null;
  organization_id: string | null;
  workflow_type: string | null;
  step: string;
  provider: string | null;
  http_status: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  message: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

// ─── Provider Name Translation ────────────────────────────────────────

function providerName(provider: string | null): string {
  if (!provider) return "un proveedor desconocido";
  const names: Record<string, string> = {
    cpnu: "la Rama Judicial (CPNU)",
    samai: "el Consejo de Estado (SAMAI)",
    tutelas: "la Corte Constitucional",
    publicaciones: "el sistema de Publicaciones Procesales",
  };
  return names[provider.toLowerCase()] || provider;
}

// ─── Diagnostic Translator ───────────────────────────────────────────

function translateDiagnostic(
  trace: SyncTrace,
  radicado: string,
  workItemId: string,
): DiagnosticEntry {
  const base = { work_item_id: workItemId, radicado };

  // Provider unreachable
  if (trace.error_code === "UPSTREAM_ROUTE_MISSING" || trace.http_status === 0) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "CONEXIÓN",
      message_es: `No se pudo conectar con ${providerName(trace.provider)}. El servicio externo no respondió. Esto puede ser una caída temporal del sistema judicial.`,
      technical_detail: `${trace.provider} returned HTTP ${trace.http_status} / error: ${trace.error_code} / latency: ${trace.latency_ms}ms`,
      suggested_action: "Atenia AI reintentará automáticamente en la próxima ventana de sincronización.",
    };
  }

  // Auth failure
  if (trace.error_code === "UPSTREAM_AUTH" || trace.http_status === 401 || trace.http_status === 403) {
    return {
      ...base,
      severity: "CRITICO",
      category: "AUTENTICACIÓN",
      message_es: `El servicio ${providerName(trace.provider)} rechazó nuestras credenciales. Es posible que la clave de acceso haya expirado o sido revocada.`,
      technical_detail: `${trace.provider} returned HTTP ${trace.http_status}`,
      suggested_action: "Verifique las claves de API en la configuración de secretos.",
    };
  }

  // Record not found
  if (trace.error_code === "RECORD_NOT_FOUND" || trace.error_code === "PROVIDER_404" ||
      (trace.http_status === 404 && trace.error_code !== "UPSTREAM_ROUTE_MISSING")) {
    return {
      ...base,
      severity: "AVISO",
      category: "BÚSQUEDA",
      message_es: `El radicado ${radicado} no fue encontrado en ${providerName(trace.provider)}. Puede que aún no esté registrado o que el número tenga un error.`,
      technical_detail: `${trace.provider} returned 404 for ${radicado}`,
      suggested_action: "Verifique que el número de radicado sea correcto (23 dígitos).",
    };
  }

  // Timeout
  if (trace.error_code === "TIMEOUT" || trace.error_code === "PROVIDER_TIMEOUT" ||
      (trace.latency_ms && trace.latency_ms > 55000)) {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "TIEMPO DE ESPERA",
      message_es: `La consulta al servicio ${providerName(trace.provider)} tardó demasiado (${Math.round((trace.latency_ms || 60000) / 1000)} segundos) y fue cancelada.`,
      technical_detail: `${trace.provider} timed out after ${trace.latency_ms}ms`,
      suggested_action: "Se reintentará automáticamente. Si persiste, el proveedor puede estar caído.",
    };
  }

  // Parse error
  if (trace.error_code === "PARSER_ERROR" || trace.error_code === "INVALID_JSON_RESPONSE") {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "FORMATO DE DATOS",
      message_es: `Se recibió información de ${providerName(trace.provider)} pero no pudo ser procesada correctamente.`,
      technical_detail: `Parse error on ${trace.provider}: ${trace.message}`,
      suggested_action: "Revise la respuesta cruda en el panel de depuración.",
    };
  }

  // Rate limited
  if (trace.http_status === 429) {
    return {
      ...base,
      severity: "AVISO",
      category: "LÍMITE DE CONSULTAS",
      message_es: `El servicio ${providerName(trace.provider)} indicó que se han realizado demasiadas consultas. Se pausará temporalmente.`,
      technical_detail: `${trace.provider} returned 429 Too Many Requests`,
      suggested_action: "Automático — Atenia AI ajustará el ritmo de consultas.",
    };
  }

  // No new data (success, 0 inserted)
  const insertedCount = (trace.meta?.inserted_count as number) || 0;
  const skippedCount = (trace.meta?.skipped_count as number) || 0;
  if (trace.success && insertedCount === 0 && skippedCount > 0) {
    return {
      ...base,
      severity: "OK",
      category: "SIN NOVEDADES",
      message_es: `El radicado ${radicado} fue consultado exitosamente. No se encontraron actuaciones nuevas.`,
      technical_detail: `${skippedCount} existing records matched by fingerprint`,
    };
  }

  // Success with new data
  if (trace.success && insertedCount > 0) {
    return {
      ...base,
      severity: "OK",
      category: "ACTUALIZADO",
      message_es: `Se encontraron ${insertedCount} nuevas actuaciones para el radicado ${radicado} en ${providerName(trace.provider)}.`,
      technical_detail: `Inserted ${insertedCount}, skipped ${skippedCount}`,
    };
  }

  // DB write failure
  if (trace.error_code === "DB_WRITE_FAILED" || trace.error_code === "DB_CONSTRAINT") {
    return {
      ...base,
      severity: "PROBLEMA",
      category: "BASE DE DATOS",
      message_es: `Error al guardar datos del radicado ${radicado} en la base de datos.`,
      technical_detail: `DB error: ${trace.error_code} / ${trace.message}`,
      suggested_action: "Contacte soporte técnico si el error persiste.",
    };
  }

  // Generic success
  if (trace.success) {
    return {
      ...base,
      severity: "OK",
      category: "OK",
      message_es: `Sincronización exitosa para ${radicado}.`,
      technical_detail: `${trace.provider} completed in ${trace.latency_ms}ms`,
    };
  }

  // Unknown error
  return {
    ...base,
    severity: "PROBLEMA",
    category: "ERROR DESCONOCIDO",
    message_es: `Ocurrió un error inesperado al consultar ${providerName(trace.provider)} para el radicado ${radicado}.`,
    technical_detail: `Unknown: ${trace.error_code} / HTTP ${trace.http_status} / ${trace.message}`,
    suggested_action: "Consulte los registros detallados en el panel de depuración.",
  };
}

// ─── Provider Health Aggregation ─────────────────────────────────────

function aggregateProviderHealth(traces: SyncTrace[]): Record<string, ProviderHealth> {
  const providers: Record<string, { latencies: number[]; errors: number; total: number; errorCodes: string[] }> = {};

  for (const t of traces) {
    if (!t.provider) continue;
    if (!providers[t.provider]) {
      providers[t.provider] = { latencies: [], errors: 0, total: 0, errorCodes: [] };
    }
    const p = providers[t.provider];
    p.total++;
    if (t.latency_ms) p.latencies.push(t.latency_ms);
    if (!t.success) {
      p.errors++;
      if (t.error_code) p.errorCodes.push(t.error_code);
    }
  }

  const result: Record<string, ProviderHealth> = {};
  for (const [name, data] of Object.entries(providers)) {
    const avgLatency = data.latencies.length > 0
      ? Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length)
      : 0;
    const errorRate = data.total > 0 ? data.errors / data.total : 0;

    let status: ProviderHealth["status"] = "healthy";
    if (errorRate >= 0.8) status = "down";
    else if (errorRate >= 0.3 || avgLatency > 10000) status = "degraded";

    // Find most common error
    const errorFreq: Record<string, number> = {};
    for (const code of data.errorCodes) {
      errorFreq[code] = (errorFreq[code] || 0) + 1;
    }
    const topError = Object.entries(errorFreq).sort((a, b) => b[1] - a[1])[0];

    result[name] = {
      status,
      avg_latency_ms: avgLatency,
      errors: data.errors,
      total_calls: data.total,
      ...(topError ? { error_pattern: topError[0] } : {}),
    };
  }
  return result;
}

// ─── Quick Health Check ──────────────────────────────────────────────

async function quickHealthCheck(provider: string): Promise<boolean> {
  const envMap: Record<string, string> = {
    cpnu: "CPNU_BASE_URL",
    samai: "SAMAI_BASE_URL",
    tutelas: "TUTELAS_BASE_URL",
    publicaciones: "PUBLICACIONES_BASE_URL",
  };
  const baseUrl = Deno.env.get(envMap[provider] || "");
  if (!baseUrl) return false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Hours Ago Helper ────────────────────────────────────────────────

function hoursAgo(dateStr: string | null): number {
  if (!dateStr) return 999;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

// ─── Gemini AI Diagnosis ─────────────────────────────────────────────

async function geminiDiagnosis(context: {
  diagnostics: DiagnosticEntry[];
  providerStatus: Record<string, ProviderHealth>;
  totalTraces: number;
  successTraces: number;
  failedTraces: number;
  avgLatency: number;
}): Promise<string | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    console.warn("[atenia-ai] No LOVABLE_API_KEY, skipping Gemini diagnosis");
    return null;
  }

  const problems = context.diagnostics.filter((d) => d.severity !== "OK");
  if (problems.length === 0) return null;

  const prompt = `Eres Atenia AI, el sistema supervisor de sincronización de ATENIA, una plataforma de gestión judicial colombiana.

Analiza el siguiente contexto de sincronización y proporciona un diagnóstico claro EN ESPAÑOL.
Tu audiencia es un administrador de plataforma legal, no un desarrollador.

## Estado de proveedores hoy:
${JSON.stringify(context.providerStatus, null, 2)}

## Patrones de error detectados:
${problems.map((d) => `- [${d.severity}] ${d.category}: ${d.message_es}`).join("\n")}

## Resumen de trazas:
- Total consultas: ${context.totalTraces}
- Exitosas: ${context.successTraces}
- Fallidas: ${context.failedTraces}
- Latencia promedio: ${context.avgLatency}ms

Responde con:
1. DIAGNÓSTICO: ¿Qué está pasando? (2-3 oraciones máximo)
2. IMPACTO: ¿Qué asuntos se ven afectados?
3. ACCIÓN RECOMENDADA: ¿Qué debe hacer el administrador? (si algo)
4. PRONÓSTICO: ¿Se resolverá solo o requiere intervención?

Sé conciso. No uses jerga técnica. Habla como un asistente legal inteligente.`;

  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });

    if (!resp.ok) {
      console.warn(`[atenia-ai] Gemini call failed: HTTP ${resp.status}`);
      const body = await resp.text();
      console.warn(`[atenia-ai] Response: ${body.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn("[atenia-ai] Gemini error:", err);
    return null;
  }
}

// ─── Remediation Engine ──────────────────────────────────────────────

async function remediate(
  supabase: ReturnType<typeof createClient>,
  diagnostics: DiagnosticEntry[],
  orgId: string,
): Promise<RemediationAction[]> {
  const actions: RemediationAction[] = [];

  for (const d of diagnostics) {
    if (d.severity === "OK") continue;

    // Auto-retry: provider was temporarily unreachable
    if (d.category === "CONEXIÓN" || d.category === "TIEMPO DE ESPERA") {
      // Extract provider from technical_detail
      const providerMatch = d.technical_detail.match(/^(\w+)\s/);
      const provider = providerMatch?.[1];
      if (provider) {
        const healthOk = await quickHealthCheck(provider);
        if (healthOk && d.work_item_id) {
          try {
            await supabase.functions.invoke("sync-by-work-item", {
              body: { work_item_id: d.work_item_id, _scheduled: true },
            });
            actions.push({
              action: "RETRY_SYNC",
              work_item_id: d.work_item_id,
              reason: "Proveedor recuperado después de falla temporal",
              result: "TRIGGERED",
            });
            d.auto_remediated = true;
          } catch (e) {
            console.warn(`[atenia-ai] Retry failed for ${d.work_item_id}:`, e);
            actions.push({
              action: "RETRY_SYNC",
              work_item_id: d.work_item_id,
              reason: "Proveedor recuperado pero reintento falló",
              result: "FAILED",
            });
          }
        }
      }
    }

    // Escalate auth failures
    if (d.category === "AUTENTICACIÓN") {
      // Find an admin for this org
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      if (membership?.user_id) {
        await supabase.from("alert_instances").insert({
          owner_id: membership.user_id,
          organization_id: orgId,
          entity_type: "SYSTEM",
          entity_id: orgId,
          severity: "CRITICAL",
          title: "🔑 Falla de autenticación con proveedor externo",
          message: d.message_es,
          status: "ACTIVE",
          fired_at: new Date().toISOString(),
          alert_type: "SYNC_AUTH_FAILURE",
          alert_source: "atenia_ai",
          fingerprint: `auth_fail_${orgId}_${new Date().toISOString().slice(0, 10)}`,
        });
        actions.push({
          action: "ESCALATE_TO_ADMIN",
          reason: d.message_es,
          result: "ALERT_CREATED",
        });
      }
    }

    // Flag stale data (>48h without sync)
    if (d.work_item_id && (d.category === "CONEXIÓN" || d.category === "TIEMPO DE ESPERA")) {
      const { data: wi } = await supabase
        .from("work_items")
        .select("last_synced_at")
        .eq("id", d.work_item_id)
        .single();

      if (wi && hoursAgo(wi.last_synced_at) > 48) {
        actions.push({
          action: "FLAG_STALE",
          work_item_id: d.work_item_id,
          reason: "Datos sin actualizar por más de 48 horas",
        });
      }
    }
  }

  return actions;
}

// ─── Today in COT ────────────────────────────────────────────────────

function todayCOT(): string {
  const now = new Date();
  // COT = UTC-5
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}

// ─── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[atenia-ai-supervisor] Starting...");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase config");

    const supabase = createClient(supabaseUrl, supabaseKey);

    let input: AteniaAIInput;
    try {
      input = await req.json();
    } catch {
      input = { mode: "POST_DAILY_SYNC" };
    }

    const runDate = input.run_date || todayCOT();
    console.log(`[atenia-ai-supervisor] Mode: ${input.mode}, Date: ${runDate}, Org: ${input.organization_id || "ALL"}`);

    // ─── HEALTH_CHECK mode: quick provider status ───
    if (input.mode === "HEALTH_CHECK") {
      const providers = ["cpnu", "samai", "tutelas", "publicaciones"];
      const checks: Record<string, boolean> = {};
      for (const p of providers) {
        checks[p] = await quickHealthCheck(p);
      }
      return new Response(
        JSON.stringify({ ok: true, mode: "HEALTH_CHECK", providers: checks, duration_ms: Date.now() - startTime }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ─── Step 1: Read daily ledger ───
    let ledgerQuery = supabase
      .from("auto_sync_daily_ledger")
      .select("*")
      .eq("run_date", runDate);

    if (input.organization_id) {
      ledgerQuery = ledgerQuery.eq("organization_id", input.organization_id);
    }

    const { data: ledgerEntries, error: ledgerError } = await ledgerQuery;
    if (ledgerError) console.warn("[atenia-ai] Ledger read error:", ledgerError.message);

    let orgIds: string[];
    if (input.organization_id) {
      orgIds = [input.organization_id];
    } else {
      // Get orgs from ledger first
      orgIds = [...new Set((ledgerEntries || []).map((l: any) => l.organization_id))];

      // For MANUAL_AUDIT: if no ledger entries exist (no daily sync ran today),
      // fall back to all orgs that have monitored work items
      if (orgIds.length === 0 && (input.mode === "MANUAL_AUDIT" || input.mode === "POST_LOGIN_SYNC")) {
        console.log("[atenia-ai-supervisor] No ledger entries found, discovering orgs from work_items...");
        const { data: wiOrgs } = await supabase
          .from("work_items")
          .select("organization_id")
          .eq("monitoring_enabled", true)
          .not("organization_id", "is", null)
          .not("radicado", "is", null);

        orgIds = [...new Set((wiOrgs || []).map((w: any) => w.organization_id))];
        console.log(`[atenia-ai-supervisor] Discovered ${orgIds.length} orgs from monitored work items`);
      }
    }

    console.log(`[atenia-ai-supervisor] Processing ${orgIds.length} organizations`);

    const allReports: any[] = [];

    for (const orgId of orgIds) {
      try {
        const report = await auditOrganization(supabase, orgId as string, runDate, input.mode);
        allReports.push(report);
      } catch (err) {
        console.error(`[atenia-ai] Org ${orgId} audit failed:`, err);
      }

      // Safety timeout at 50s
      if (Date.now() - startTime > 50000) {
        console.log("[atenia-ai-supervisor] Timeout, stopping org iteration");
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[atenia-ai-supervisor] Complete in ${durationMs}ms. ${allReports.length} reports generated.`);

    return new Response(
      JSON.stringify({
        ok: true,
        mode: input.mode,
        run_date: runDate,
        organizations_audited: allReports.length,
        reports: allReports.map((r) => ({
          organization_id: r.organization_id,
          total_work_items: r.total_work_items,
          items_synced_ok: r.items_synced_ok,
          items_failed: r.items_failed,
          new_actuaciones: r.new_actuaciones_found,
          new_publicaciones: r.new_publicaciones_found,
          ai_diagnosis: r.ai_diagnosis ? true : false,
          remediation_count: r.remediation_actions?.length || 0,
        })),
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[atenia-ai-supervisor] Fatal error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, duration_ms: Date.now() - startTime }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── Per-Organization Audit ──────────────────────────────────────────

async function auditOrganization(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  runDate: string,
  mode: string,
) {
  console.log(`[atenia-ai] Auditing org: ${orgId}`);

  // Step 2: Read sync traces for today
  const dayStart = `${runDate}T00:00:00.000Z`;
  const dayEnd = `${runDate}T23:59:59.999Z`;

  const { data: traces, error: tracesError } = await supabase
    .from("sync_traces")
    .select("*")
    .eq("organization_id", orgId)
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (tracesError) {
    console.warn(`[atenia-ai] Traces error for ${orgId}:`, tracesError.message);
  }

  const traceData: SyncTrace[] = (traces || []) as any[];
  console.log(`[atenia-ai] Found ${traceData.length} traces for org ${orgId}`);

  // Get work items for this org
  const { data: workItems } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, last_synced_at, monitoring_enabled, title")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .not("radicado", "is", null);

  const wiMap = new Map<string, any>();
  for (const wi of workItems || []) {
    wiMap.set(wi.id, wi);
  }

  // Step 3 & 4: Analyze & diagnose per work item
  // Group traces by work_item_id, take the terminal trace per item
  const tracesByWI = new Map<string, SyncTrace[]>();
  for (const t of traceData) {
    if (!t.work_item_id) continue;
    if (!tracesByWI.has(t.work_item_id)) tracesByWI.set(t.work_item_id, []);
    tracesByWI.get(t.work_item_id)!.push(t);
  }

  const diagnostics: DiagnosticEntry[] = [];
  let newActuaciones = 0;
  let newPublicaciones = 0;
  let itemsOk = 0;
  let itemsPartial = 0;
  let itemsFailed = 0;

  for (const [wiId, wiTraces] of tracesByWI) {
    const wi = wiMap.get(wiId);
    const radicado = wi?.radicado || "desconocido";

    // Find the terminal trace (last one)
    const terminalTrace = wiTraces[wiTraces.length - 1];
    const diag = translateDiagnostic(terminalTrace, radicado, wiId);
    diagnostics.push(diag);

    // Count new data
    for (const t of wiTraces) {
      const inserted = (t.meta?.inserted_count as number) || 0;
      if (t.provider === "publicaciones") {
        newPublicaciones += inserted;
      } else {
        newActuaciones += inserted;
      }
    }

    if (diag.severity === "OK") itemsOk++;
    else if (diag.severity === "AVISO") itemsPartial++;
    else itemsFailed++;
  }

  // Step 3c: Ghost item detection — monitored items with zero traces
  const tracedItemIds = new Set([...tracesByWI.keys()]);
  const ghostItems = (workItems || []).filter((wi: any) => !tracedItemIds.has(wi.id));
  
  if (ghostItems.length > 0) {
    console.log(`[atenia-ai] ${ghostItems.length} monitored items had no traces (ghost items)`);
    for (const ghost of ghostItems) {
      diagnostics.push({
        work_item_id: ghost.id,
        radicado: ghost.radicado || 'desconocido',
        severity: "AVISO",
        category: "OMITIDO",
        message_es: `El radicado ${ghost.radicado || 'desconocido'} tiene monitoreo activo pero no fue consultado en la sincronización de hoy. Puede haber sido omitido por tiempo de espera del sistema.`,
        technical_detail: `No sync_traces found for work_item ${ghost.id} on ${runDate}`,
        suggested_action: "Se reintentará en la próxima ventana de sincronización.",
      });
    }
  }

  // Step 3b: Provider health aggregation
  const providerStatus = aggregateProviderHealth(traceData);

  // Step 5: Remediate
  let remediationActions: RemediationAction[] = [];
  if (mode !== "HEALTH_CHECK") {
    remediationActions = await remediate(supabase, diagnostics, orgId);
  }

  // Step 6a: Gemini diagnosis for complex failures
  let aiDiagnosis: string | null = null;
  const problems = diagnostics.filter((d) => d.severity !== "OK" && d.severity !== "AVISO");
  const shouldUseGemini =
    problems.length >= 3 ||
    diagnostics.length > 0 ||
    Object.values(providerStatus).some((p) => p.status === "degraded" || p.status === "down") ||
    mode === "MANUAL_AUDIT";

  if (shouldUseGemini) {
    const avgLatency = traceData.length > 0
      ? Math.round(traceData.reduce((s, t) => s + (t.latency_ms || 0), 0) / traceData.length)
      : 0;

    aiDiagnosis = await geminiDiagnosis({
      diagnostics,
      providerStatus,
      totalTraces: traceData.length,
      successTraces: traceData.filter((t) => t.success).length,
      failedTraces: traceData.filter((t) => !t.success).length,
      avgLatency,
    });
  }

  // Step 6b: Write report
  const reportData = {
    organization_id: orgId,
    report_date: runDate,
    report_type: mode === "MANUAL_AUDIT" ? "MANUAL_AUDIT" : mode === "HEALTH_CHECK" ? "HEALTH_CHECK" : "DAILY_AUDIT",
    total_work_items: wiMap.size,
    items_synced_ok: itemsOk,
    items_synced_partial: itemsPartial,
    items_failed: itemsFailed,
    new_actuaciones_found: newActuaciones,
    new_publicaciones_found: newPublicaciones,
    provider_status: providerStatus,
    diagnostics: diagnostics.slice(0, 200), // Cap at 200 entries
    remediation_actions: remediationActions,
    ai_diagnosis: aiDiagnosis,
    lexy_data_ready: true,
  };

  const { error: reportError } = await supabase
    .from("atenia_ai_reports")
    .upsert(reportData, { onConflict: "organization_id,report_date,report_type" });

  if (reportError) {
    console.error(`[atenia-ai] Report write error for ${orgId}:`, reportError.message);
  } else {
    console.log(`[atenia-ai] Report saved for org ${orgId}: ${itemsOk} OK, ${itemsFailed} failed, ${newActuaciones} new acts, ${newPublicaciones} new pubs`);
  }

    // Step 8: Critical failure alerts for ALL CRITICO diagnostics (not just AUTH)
    const criticals = diagnostics.filter((d) => d.severity === "CRITICO");
    if (criticals.length > 0) {
      console.log(`[atenia-ai] ${criticals.length} CRITICAL issues for org ${orgId}`);

      // Find an admin to notify
      const { data: adminMember } = await supabase
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      if (adminMember?.user_id) {
        // Only create alerts for non-AUTH criticals (AUTH already handled in remediate())
        const nonAuthCriticals = criticals.filter((d) => d.category !== "AUTENTICACIÓN");
        for (const d of nonAuthCriticals) {
          const fingerprint = `critico_${d.category}_${orgId}_${runDate}`;
          await supabase.from("alert_instances").insert({
            owner_id: adminMember.user_id,
            organization_id: orgId,
            entity_type: "SYSTEM",
            entity_id: orgId,
            severity: "CRITICAL",
            title: `⚠️ Error crítico: ${d.category}`,
            message: d.message_es,
            status: "ACTIVE",
            fired_at: new Date().toISOString(),
            alert_type: "SYNC_FAILURE",
            alert_source: "atenia_ai",
            fingerprint,
          });
        }
      }
    }

  return reportData;
}
