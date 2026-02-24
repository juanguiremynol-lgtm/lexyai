/**
 * orchestrator-debug-run — Instrumented orchestrator sync for debugging.
 *
 * Wraps the real orchestrateSync() with full payload capture, freshness gate
 * diagnostics, and per-provider raw data recording.
 *
 * Access: Platform admins and org admins only.
 *
 * Input:
 *   - radicado: string (23 digits)
 *   - work_item_id?: string (optional, auto-resolved from radicado)
 *   - force_refresh?: boolean (force /buscar instead of /snapshot)
 *   - dry_run?: boolean (no DB writes for actuaciones/publicaciones)
 *   - providers?: string[] (filter to specific providers, default ALL)
 *
 * Output:
 *   - run_id: string (correlation ID)
 *   - status: SUCCESS | PARTIAL | FAILED | TIMEOUT
 *   - provider_results: per-provider summary
 *   - coverage_plan: which providers were planned and why
 *   - freshness_gate: CPNU freshness diagnostics
 *   - db_state: current DB counts for the work item
 *   - payloads_recorded: number of debug payloads persisted
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  orchestrateSync,
  createFetchRegistry,
  recordDebugPayload,
  type SyncRunContext,
} from "../_shared/syncOrchestrator.ts";
import {
  loadCoverageOverrides,
  getProviderCoverageWithOverrides,
} from "../_shared/providerCoverageMatrix.ts";
import {
  createLegacyAdapter,
} from "../_shared/providerAdapters.ts";
import {
  fetchFromCpnu,
  fetchFromSamai,
  fetchFromTutelas,
  fetchFromPublicaciones,
  fetchFromSamaiEstados,
} from "../_shared/providerAdapters/index.ts";
import { toOrchestratorResult } from "../_shared/providerAdapters/bridge.ts";
import {
  getDbMaxActDate,
  getHistoricalRecordCount,
} from "../_shared/cpnuFreshnessGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const authHeader = req.headers.get("Authorization") || `Bearer ${serviceRoleKey}`;

  try {
    // ── Auth: verify caller is platform admin or org admin ──
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ).auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check platform admin
    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const isPlatformAdmin = !!platformAdmin;

    // ── Parse input ──
    const body = await req.json();
    const {
      radicado: rawRadicado,
      work_item_id: inputWorkItemId,
      force_refresh = false,
      dry_run = false,
      providers: filterProviders,
    } = body;

    const radicado = (rawRadicado || "").replace(/\D/g, "");
    if (!radicado || radicado.length !== 23) {
      return new Response(JSON.stringify({ error: "radicado must be 23 digits" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Resolve work item ──
    let workItemId = inputWorkItemId;
    let workItem: any = null;

    if (workItemId) {
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, organization_id, owner_id, needs_cpnu_refresh")
        .eq("id", workItemId)
        .is("deleted_at", null)
        .maybeSingle();
      workItem = data;
    }

    if (!workItem) {
      const { data } = await supabase
        .from("work_items")
        .select("id, radicado, workflow_type, organization_id, owner_id, needs_cpnu_refresh")
        .eq("radicado", radicado)
        .is("deleted_at", null)
        .maybeSingle();
      workItem = data;
    }

    if (!workItem) {
      return new Response(JSON.stringify({
        error: `No work item found for radicado ${radicado}`,
        hint: "The radicado must be associated with an existing work item.",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    workItemId = workItem.id;
    const orgId = workItem.organization_id;
    const workflowType = workItem.workflow_type || "CGP";

    // ── Auth: verify org membership if not platform admin ──
    if (!isPlatformAdmin) {
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .in("role", ["OWNER", "ADMIN"])
        .maybeSingle();

      if (!membership) {
        return new Response(JSON.stringify({ error: "Not authorized for this organization" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Freshness gate diagnostics (CPNU specific) ──
    const freshnessGate: Record<string, unknown> = {};
    try {
      const dbMaxDate = await getDbMaxActDate(supabase, workItemId);
      const histCount = await getHistoricalRecordCount(supabase, workItemId);
      freshnessGate.db_max_act_date = dbMaxDate;
      freshnessGate.historical_record_count = histCount;
      freshnessGate.needs_cpnu_refresh = workItem.needs_cpnu_refresh || false;
      freshnessGate.force_refresh_requested = force_refresh;
    } catch (e) {
      freshnessGate.error = String(e);
    }

    // ── Coverage plan: what providers WILL be called ──
    const overrides = await loadCoverageOverrides(supabase);
    const actCoverage = getProviderCoverageWithOverrides(workflowType, "ACTUACIONES", overrides);
    const estCoverage = getProviderCoverageWithOverrides(workflowType, "ESTADOS", overrides);

    const coveragePlan = {
      workflow_type: workflowType,
      actuaciones: {
        execution_mode: actCoverage.executionMode,
        providers: actCoverage.providers.map(p => ({
          key: p.key,
          role: p.role,
          enabled: !filterProviders || filterProviders.includes(p.key.toLowerCase()),
        })),
      },
      estados: {
        execution_mode: estCoverage.executionMode,
        providers: estCoverage.providers.map(p => ({
          key: p.key,
          role: p.role,
          enabled: !filterProviders || filterProviders.includes(p.key.toLowerCase()),
        })),
      },
    };

    // ── Build fetch registry with all providers ──
    const cpnuBaseUrl = Deno.env.get("CPNU_BASE_URL") || "";
    const samaiBaseUrl = Deno.env.get("SAMAI_BASE_URL") || "";
    const tutelasBaseUrl = Deno.env.get("TUTELAS_BASE_URL") || "";
    const pubBaseUrl = Deno.env.get("PUBLICACIONES_BASE_URL") || "";
    const samaiEstadosBaseUrl = Deno.env.get("SAMAI_ESTADOS_BASE_URL") || "";
    const externalApiKey = Deno.env.get("EXTERNAL_X_API_KEY") || "";

    // Build adapters that wrap the shared provider functions
    const registry = createFetchRegistry([
      {
        key: "CPNU",
        fetchFn: createLegacyAdapter(async (rad: string) => {
          const result = await fetchFromCpnu({
            radicado: rad,
            baseUrl: cpnuBaseUrl,
            apiKey: externalApiKey,
            workItemId,
            mode: "monitoring",
            forceRefresh: force_refresh,
          });
          return toOrchestratorResult(result) as any;
        }),
      },
      {
        key: "SAMAI",
        fetchFn: createLegacyAdapter(async (rad: string) => {
          const result = await fetchFromSamai({
            radicado: rad,
            baseUrl: samaiBaseUrl,
            apiKey: externalApiKey,
            workItemId,
            mode: "monitoring",
          });
          return toOrchestratorResult(result) as any;
        }),
      },
      {
        key: "TUTELAS",
        fetchFn: createLegacyAdapter(async (rad: string) => {
          const result = await fetchFromTutelas({
            radicado: rad,
            baseUrl: tutelasBaseUrl,
            apiKey: externalApiKey,
            workItemId,
            mode: "monitoring",
          });
          return toOrchestratorResult(result) as any;
        }),
      },
      {
        key: "PUBLICACIONES",
        fetchFn: createLegacyAdapter(async (rad: string) => {
          const result = await fetchFromPublicaciones({
            radicado: rad,
            baseUrl: pubBaseUrl,
            apiKey: externalApiKey,
            workItemId,
            mode: "monitoring",
          });
          return toOrchestratorResult(result) as any;
        }),
      },
      {
        key: "SAMAI_ESTADOS",
        fetchFn: createLegacyAdapter(async (rad: string) => {
          const result = await fetchFromSamaiEstados({
            radicado: rad,
            baseUrl: samaiEstadosBaseUrl,
            apiKey: externalApiKey,
            workItemId,
            mode: "monitoring",
          });
          return toOrchestratorResult(result) as any;
        }),
      },
    ]);

    // ── Execute orchestrator in debug mode ──
    const ctx: SyncRunContext = {
      workItemId,
      organizationId: orgId,
      workflowType,
      radicado,
      invokedBy: "MANUAL",
      triggerSource: "orchestrator-debug-run",
    };

    const syncResult = await orchestrateSync(
      ctx,
      registry,
      supabase,
      supabaseUrl,
      authHeader,
      {
        debugMode: true,
        runMode: dry_run ? "DRY_RUN" : "MANUAL_DEBUG",
        dryRun: dry_run,
        coverageOverrides: overrides,
      },
    );

    // ── Record freshness gate payload ──
    if (syncResult.syncRunId) {
      await recordDebugPayload(supabase, syncResult.syncRunId, "cpnu", "freshness_gate", freshnessGate);
    }

    // ── DB state snapshot ──
    const [{ count: actCount }, { count: pubCount }] = await Promise.all([
      supabase.from("work_item_acts").select("id", { count: "exact", head: true })
        .eq("work_item_id", workItemId).eq("is_archived", false),
      supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true })
        .eq("work_item_id", workItemId).eq("is_archived", false),
    ]);

    // Source breakdown
    const { data: srcData } = await supabase
      .from("work_item_acts")
      .select("source")
      .eq("work_item_id", workItemId)
      .eq("is_archived", false);
    const sourceBreakdown: Record<string, number> = {};
    for (const row of srcData || []) {
      sourceBreakdown[row.source || "unknown"] = (sourceBreakdown[row.source || "unknown"] || 0) + 1;
    }

    // Count payloads recorded
    let payloadsRecorded = 0;
    if (syncResult.syncRunId) {
      const { count } = await supabase
        .from("external_sync_run_payloads")
        .select("id", { count: "exact", head: true })
        .eq("sync_run_id", syncResult.syncRunId);
      payloadsRecorded = count || 0;
    }

    // ── Response ──
    const response = {
      run_id: syncResult.syncRunId,
      radicado,
      work_item_id: workItemId,
      workflow_type: workflowType,
      status: syncResult.status,
      duration_ms: syncResult.durationMs,
      found_status: syncResult.foundStatus,

      // Per-provider results (sanitized: no raw API keys)
      provider_results: syncResult.providerAttempts.map(a => ({
        provider: a.provider,
        data_kind: a.data_kind,
        role: a.role,
        status: a.status,
        http_code: a.http_code,
        latency_ms: a.latency_ms,
        inserted_count: a.inserted_count,
        skipped_count: a.skipped_count,
        error_code: a.error_code,
        error_message: a.error_message,
      })),

      // Coverage plan
      coverage_plan: coveragePlan,

      // Freshness gate diagnostics
      freshness_gate: freshnessGate,

      // Current DB state
      db_state: {
        actuaciones_count: actCount || 0,
        publicaciones_count: pubCount || 0,
        source_breakdown: sourceBreakdown,
      },

      // Summary counts
      totals: {
        inserted_acts: syncResult.totalInsertedActs,
        skipped_acts: syncResult.totalSkippedActs,
        inserted_pubs: syncResult.totalInsertedPubs,
        skipped_pubs: syncResult.totalSkippedPubs,
      },

      payloads_recorded: payloadsRecorded,
      dry_run,
      force_refresh,
      initiated_by: user.id,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[orchestrator-debug-run] Error:", err);
    return new Response(JSON.stringify({
      error: err.message || String(err),
      stack: (err.stack || "").split("\n").slice(0, 5),
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** Sanitize metadata for debug output: remove API keys, limit size */
function sanitizeForDebug(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    // Skip internal large objects
    if (key === "_legacyResult") {
      // Extract key fields only
      const legacy = val as any;
      result[key] = {
        ok: legacy?.ok,
        actuaciones_count: legacy?.actuaciones?.length ?? 0,
        isEmpty: legacy?.isEmpty,
        error: legacy?.error,
        provider: legacy?.provider,
        httpStatus: legacy?.httpStatus,
        scrapingInitiated: legacy?.scrapingInitiated,
        // Include first 3 actuaciones as sample
        actuaciones_sample: (legacy?.actuaciones || []).slice(0, 3).map((a: any) => ({
          fecha: a.fecha || a.fecha_actuacion,
          actuacion: (a.actuacion || a.tipo || "").slice(0, 100),
          anotacion: (a.anotacion || "").slice(0, 100),
        })),
      };
      continue;
    }
    // Redact anything that looks like a key/secret
    if (typeof val === "string" && (key.includes("key") || key.includes("secret") || key.includes("token"))) {
      result[key] = val ? `***${val.slice(-4)}` : null;
      continue;
    }
    result[key] = val;
  }
  return result;
}
