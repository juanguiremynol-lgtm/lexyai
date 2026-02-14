/**
 * atenia-preflight-check — Pre-flight API verification for all providers.
 *
 * Runs lightweight connectivity + auth + data-shape probes against:
 *   - 4 built-in providers (CPNU, SAMAI, Publicaciones, Tutelas)
 *   - All active external provider connectors
 *
 * Called BEFORE daily sync, periodically from heartbeat (~every 90 min),
 * or manually from the Supervisor Panel.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logAction } from "../_shared/action-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PreflightResult {
  provider: string;
  provider_type: "BUILT_IN" | "EXTERNAL";
  checks: {
    connectivity: { ok: boolean; latency_ms: number; status_code?: number; error?: string };
    authentication: { ok: boolean; latency_ms: number; error?: string };
    data_shape: { ok: boolean; latency_ms: number; error?: string; sample_fields?: string[] };
    response_time: { ok: boolean; latency_ms: number; threshold_ms: number };
  };
  overall: "PASS" | "WARN" | "FAIL";
  failure_reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "atenia-preflight-check" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: { organization_id?: string; trigger?: string } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const orgId = body.organization_id;
  const trigger = body.trigger ?? "MANUAL";
  const startTime = Date.now();
  const results: PreflightResult[] = [];

  try {
    // === BUILT-IN PROVIDERS ===
    const apiKey = Deno.env.get("EXTERNAL_X_API_KEY") ?? "";

    const builtIns = [
      {
        name: "CPNU",
        baseUrl: Deno.env.get("CPNU_BASE_URL"),
        testEndpoint: (r: string) => `/snapshot?numero_radicacion=${r}`,
        testRadicado: "05001400301520240193000",
        expectedFields: ["actuaciones", "radicado"],
      },
      {
        name: "SAMAI",
        baseUrl: Deno.env.get("SAMAI_BASE_URL"),
        testEndpoint: (r: string) => `/buscar?numero_radicacion=${r}`,
        testRadicado: "05001233300020240115300",
        expectedFields: ["actuaciones", "radicado"],
      },
      {
        name: "PUBLICACIONES",
        baseUrl: Deno.env.get("PUBLICACIONES_BASE_URL"),
        testEndpoint: (r: string) => `/snapshot/${r}`,
        testRadicado: "05001400301520240193000",
        expectedFields: ["publicaciones", "radicado"],
      },
      {
        name: "TUTELAS",
        baseUrl: Deno.env.get("TUTELAS_BASE_URL"),
        testEndpoint: (r: string) => `/buscar?radicado=${r}`,
        testRadicado: "05001400301520240193000",
        expectedFields: [],
      },
    ];

    // Run built-in checks in parallel
    const builtInResults = await Promise.all(
      builtIns.map((p) => checkBuiltInProvider(p, apiKey))
    );
    results.push(...builtInResults);

    // === EXTERNAL PROVIDER CONNECTORS ===
    const { data: connectors } = await supabase
      .from("provider_connectors")
      .select("id, name, key")
      .eq("is_active", true);

    for (const connector of connectors ?? []) {
      const { data: instances } = await supabase
        .from("provider_instances")
        .select("id, is_enabled, scope, config")
        .eq("connector_id", connector.id)
        .eq("is_enabled", true)
        .limit(1);

      const instance = instances?.[0];
      if (!instance) {
        results.push({
          provider: connector.name,
          provider_type: "EXTERNAL",
          checks: {
            connectivity: { ok: false, latency_ms: 0, error: "No active instance" },
            authentication: { ok: false, latency_ms: 0, error: "No instance" },
            data_shape: { ok: false, latency_ms: 0, error: "No instance" },
            response_time: { ok: false, latency_ms: 0, threshold_ms: 10000 },
          },
          overall: "FAIL",
          failure_reason: "No active provider instance configured",
        });
        continue;
      }

      // Check secret exists
      const { data: secret } = await supabase
        .from("provider_instance_secrets")
        .select("id")
        .eq("instance_id", instance.id)
        .limit(1)
        .maybeSingle();

      // Check mapping spec exists
      const { count: mappingCount } = await supabase
        .from("provider_mapping_specs")
        .select("*", { count: "exact", head: true })
        .eq("connector_id", connector.id);

      const baseUrl = (instance.config as any)?.base_url;
      let connOk = false;
      let connLatency = 0;

      if (baseUrl) {
        try {
          const t0 = Date.now();
          const res = await fetch(baseUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(10000),
          });
          connLatency = Date.now() - t0;
          connOk = res.status < 500;
        } catch {
          connOk = false;
        }
      }

      const secretOk = !!secret;
      const mappingOk = (mappingCount ?? 0) > 0;
      const allOk = connOk && secretOk && mappingOk;

      results.push({
        provider: connector.name,
        provider_type: "EXTERNAL",
        checks: {
          connectivity: {
            ok: connOk,
            latency_ms: connLatency,
            error: !baseUrl ? "No base URL configured" : (!connOk ? "Connection failed" : undefined),
          },
          authentication: {
            ok: secretOk,
            latency_ms: 0,
            error: !secretOk ? "No secret configured" : undefined,
          },
          data_shape: {
            ok: mappingOk,
            latency_ms: 0,
            error: !mappingOk ? "No mapping spec — data won't reach canonical tables" : undefined,
          },
          response_time: {
            ok: connLatency < 10000,
            latency_ms: connLatency,
            threshold_ms: 10000,
          },
        },
        overall: allOk ? "PASS" : connOk ? "WARN" : "FAIL",
        failure_reason: !allOk
          ? `Failed: ${[!connOk && "connectivity", !secretOk && "authentication", !mappingOk && "data_shape"].filter(Boolean).join(", ")}`
          : undefined,
      });
    }

    // === DECISION ===
    const failed = results.filter((r) => r.overall === "FAIL");
    const builtInFailed = failed.filter((r) => r.provider_type === "BUILT_IN");

    let overallStatus: string;
    let decision: string;

    if (failed.length === 0) {
      overallStatus = "ALL_PASS";
      decision = "PROCEED";
    } else if (builtInFailed.length >= 2) {
      overallStatus = "CRITICAL_FAILURE";
      decision = trigger === "PRE_DAILY_SYNC" ? "DELAY_SYNC" : "PROCEED_DEGRADED";
    } else if (failed.length > 0) {
      overallStatus = "PARTIAL";
      decision = failed.map((f) => `SKIP_PROVIDER_${f.provider}`).join(",");
    } else {
      overallStatus = "PARTIAL";
      decision = "PROCEED_DEGRADED";
    }

    const duration = Date.now() - startTime;

    // Store results
    await supabase.from("atenia_preflight_checks").insert({
      organization_id: orgId ?? null,
      trigger,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      overall_status: overallStatus,
      results,
      providers_tested: results.length,
      providers_passed: results.filter((r) => r.overall === "PASS").length,
      providers_failed: failed.length,
      decision,
    });

    // Log action
    await logAction(supabase, {
      action_type: "PREFLIGHT_CHECK",
      actor: "AI_AUTOPILOT",
      scope: "PLATFORM",
      organization_id: orgId ?? undefined,
      autonomy_tier: "ACT",
      reasoning: `Pre-vuelo ${trigger}: ${results.filter((r) => r.overall === "PASS").length}/${results.length} proveedores OK.${failed.length > 0 ? ` Fallidos: ${failed.map((f) => f.provider).join(", ")}.` : ""} Decisión: ${decision}.`,
      status: "EXECUTED",
      action_result: overallStatus,
      evidence: {
        trigger,
        duration_ms: duration,
        overall: overallStatus,
        decision,
        providers_tested: results.length,
        providers_passed: results.filter((r) => r.overall === "PASS").length,
        failed_providers: failed.map((f) => ({ provider: f.provider, reason: f.failure_reason })),
      },
    });

    return new Response(
      JSON.stringify({ ok: true, overall: overallStatus, decision, duration_ms: duration, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Built-in provider check ───

async function checkBuiltInProvider(
  provider: {
    name: string;
    baseUrl?: string;
    testEndpoint: (r: string) => string;
    testRadicado: string;
    expectedFields: string[];
  },
  apiKey: string
): Promise<PreflightResult> {
  const result: PreflightResult = {
    provider: provider.name,
    provider_type: "BUILT_IN",
    checks: {
      connectivity: { ok: false, latency_ms: 0 },
      authentication: { ok: false, latency_ms: 0 },
      data_shape: { ok: false, latency_ms: 0 },
      response_time: { ok: false, latency_ms: 0, threshold_ms: 5000 },
    },
    overall: "FAIL",
  };

  if (!provider.baseUrl) {
    result.failure_reason = `${provider.name}_BASE_URL not configured`;
    return result;
  }

  // Combined connectivity + auth + data shape in one authenticated request
  try {
    const url = `${provider.baseUrl}${provider.testEndpoint(provider.testRadicado)}`;
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: apiKey ? { "x-api-key": apiKey } : {},
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - t0;

    result.checks.connectivity = { ok: res.status < 500, latency_ms: latency, status_code: res.status };
    result.checks.response_time = { ok: latency < 5000, latency_ms: latency, threshold_ms: 5000 };

    if (res.status === 401 || res.status === 403) {
      result.checks.authentication = { ok: false, latency_ms: latency, error: `Auth failed (HTTP ${res.status})` };
      result.failure_reason = `Authentication failed for ${provider.name}`;
      result.overall = "FAIL";
      return result;
    }

    result.checks.authentication = { ok: true, latency_ms: latency };

    if (res.status === 200) {
      try {
        const body = await res.json();
        const fields = Object.keys(body);
        result.checks.data_shape = { ok: true, latency_ms: latency, sample_fields: fields.slice(0, 10) };
      } catch {
        result.checks.data_shape = { ok: false, latency_ms: latency, error: "Response is not valid JSON" };
      }
    } else if (res.status === 404) {
      // 404 for test radicado = auth worked, radicado doesn't exist — OK
      result.checks.data_shape = { ok: true, latency_ms: latency };
    } else {
      result.checks.data_shape = { ok: false, latency_ms: latency, error: `Unexpected status ${res.status}` };
    }
  } catch (err) {
    result.checks.connectivity = { ok: false, latency_ms: 0, error: (err as Error).message };
    result.failure_reason = `Connectivity failed: ${(err as Error).message}`;
    return result;
  }

  // Determine overall
  const allOk = Object.values(result.checks).every((c) => c.ok);
  result.overall = allOk ? "PASS" : result.checks.connectivity.ok ? "WARN" : "FAIL";

  if (!allOk) {
    const failedChecks = Object.entries(result.checks).filter(([, c]) => !c.ok).map(([k]) => k);
    result.failure_reason = `Failed checks: ${failedChecks.join(", ")}`;
  }

  return result;
}
