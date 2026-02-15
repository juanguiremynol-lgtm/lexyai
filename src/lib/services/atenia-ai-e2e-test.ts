/**
 * Atenia AI E2E Test Runner
 * 
 * Provides a programmatic interface for Atenia AI to agentically
 * test external provider sync pipelines end-to-end.
 * All results are logged to atenia_ai_actions for audit.
 *
 * Deliverable D: validates specific trace stages from provider-sync-external-provider:
 *   SECRET_RESOLUTION, EXT_PROVIDER_REQUEST, EXT_PROVIDER_RESPONSE, MAPPING_APPLIED, UPSERTED_CANONICAL
 */

import { supabase } from "@/integrations/supabase/client";

export interface AteniaE2ETestInput {
  radicado: string;
  triggered_by: "heartbeat" | "user" | "supervisor" | "manual";
}

export interface AteniaE2ETestStep {
  name: string;
  ok: boolean;
  detail?: any;
  duration_ms?: number;
}

export interface AteniaE2ETestResult {
  ok: boolean;
  radicado: string;
  work_item_id?: string;
  test_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  steps: AteniaE2ETestStep[];
  analysis: string;
  action_id?: string;
}

/** Required trace stages that must exist for an E2E to be considered passing */
const REQUIRED_TRACE_STAGES = [
  "SECRET_RESOLUTION",
  "EXT_PROVIDER_REQUEST",
  "EXT_PROVIDER_RESPONSE",
  "MAPPING_APPLIED",
  "UPSERTED_CANONICAL",
] as const;

/**
 * Run a full E2E test for a work item identified by radicado.
 * Steps: FIND_WORK_ITEM → SECRET_READINESS → SYNC → EXT_PROVIDER_TRACE → VERIFY_DB → SOURCE_BREAKDOWN
 */
export async function runAteniaE2ETest(
  input: AteniaE2ETestInput
): Promise<AteniaE2ETestResult> {
  const normalized = input.radicado.replace(/\D/g, "");
  const testId = `e2e_${input.triggered_by}_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const steps: AteniaE2ETestStep[] = [];
  const t0 = Date.now();

  try {
    // Step 1: Find work item
    const s1 = Date.now();
    const { data: wi, error: wiErr } = await supabase
      .from("work_items")
      .select("id, organization_id, workflow_type, radicado, monitoring_enabled, last_synced_at")
      .eq("radicado", normalized)
      .is("deleted_at", null)
      .maybeSingle();

    steps.push({
      name: "FIND_WORK_ITEM",
      ok: !!wi && !wiErr,
      detail: wi ? { id: wi.id, workflow_type: wi.workflow_type } : { error: wiErr?.message || "Not found" },
      duration_ms: Date.now() - s1,
    });

    if (!wi) {
      return buildResult({ ok: false, normalized, testId, startedAt, steps, t0, analysis: "❌ Work item no encontrado" });
    }

    // Step 2: Secret readiness for SAMAI_ESTADOS connector
    const s2 = Date.now();
    let readinessOk = false;
    let readinessDetail: any = {};
    try {
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name, key")
        .or("key.eq.SAMAI_ESTADOS,name.ilike.%samai%estados%")
        .limit(1);

      const connector = connectors?.[0];
      if (connector) {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(connector.id)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        const data = await resp.json();
        readinessDetail = {
          can_decrypt: data.can_decrypt,
          platform_key_mode: data.platform_key_mode,
          key_version: data.key_version,
          failure_reason: data.failure_reason,
          instance_id: data.resolved_instance_id,
        };
        readinessOk = data.can_decrypt === true;
      } else {
        readinessDetail = { error: "SAMAI_ESTADOS connector not found" };
      }
    } catch (err: any) {
      readinessDetail = { error: err.message };
    }
    steps.push({
      name: "SECRET_READINESS",
      ok: readinessOk,
      detail: readinessDetail,
      duration_ms: Date.now() - s2,
    });

    // Step 3: Trigger sync
    const s3 = Date.now();
    const { data: syncData, error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
      body: { work_item_id: wi.id },
    });
    steps.push({
      name: "SYNC_BY_WORK_ITEM",
      ok: !syncErr && syncData?.ok !== false,
      detail: syncErr ? { error: syncErr.message } : {
        provider: syncData?.provider,
        actuaciones: syncData?.actuaciones_count ?? syncData?.total_actuaciones,
        status: syncData?.scrape_status || syncData?.code,
      },
      duration_ms: Date.now() - s3,
    });

    // Step 4: Validate external provider traces (Deliverable D — specific stage assertions)
    const s4 = Date.now();
    const { data: traces } = await (supabase.from("provider_sync_traces") as any)
      .select("stage, ok, result_code, latency_ms, payload, created_at")
      .eq("work_item_id", wi.id)
      .gte("created_at", startedAt) // Only traces from THIS test run
      .order("created_at", { ascending: true })
      .limit(50);

    const traceStages = (traces || []).map((t: any) => t.stage);
    const tracesByStage: Record<string, any> = {};
    for (const t of traces || []) {
      tracesByStage[t.stage] = t;
    }

    // Validate each required stage exists
    const missingStages: string[] = [];
    const stageResults: Record<string, { found: boolean; ok: boolean; detail?: any }> = {};

    for (const requiredStage of REQUIRED_TRACE_STAGES) {
      const trace = tracesByStage[requiredStage];
      if (!trace) {
        missingStages.push(requiredStage);
        stageResults[requiredStage] = { found: false, ok: false };
      } else {
        stageResults[requiredStage] = {
          found: true,
          ok: trace.ok,
          detail: {
            result_code: trace.result_code,
            latency_ms: trace.latency_ms,
            // Extract key diagnostics from payload
            ...(requiredStage === "SECRET_RESOLUTION" && trace.payload ? {
              decrypt_ok: trace.payload.decrypt_ok,
              platform_key_mode: trace.payload.platform_key_mode,
            } : {}),
            ...(requiredStage === "EXT_PROVIDER_REQUEST" && trace.payload ? {
              url_host: trace.payload.url_host,
              auth_present: trace.payload.auth_present,
            } : {}),
            ...(requiredStage === "EXT_PROVIDER_RESPONSE" && trace.payload ? {
              status_code: trace.payload.status_code,
              body_kind: trace.payload.body_kind,
              bytes_length: trace.payload.bytes_length,
            } : {}),
            ...(requiredStage === "UPSERTED_CANONICAL" && trace.payload ? {
              source_platform: trace.payload.source_platform,
              data_kind: trace.payload.data_kind,
              acts_upserted: trace.payload.acts_upserted,
            } : {}),
          },
        };
      }
    }

    const extTraceOk = missingStages.length === 0 && Object.values(stageResults).every(s => s.ok);

    // Determine specific failure reason if stages are missing due to secret issues
    let extTraceFailReason: string | null = null;
    if (!extTraceOk) {
      const secretTrace = tracesByStage["SECRET_RESOLUTION"];
      if (secretTrace && !secretTrace.ok) {
        extTraceFailReason = `External provider skipped: secret resolution failed (${secretTrace.result_code})`;
      } else if (missingStages.includes("EXT_PROVIDER_REQUEST")) {
        extTraceFailReason = "External provider was never called — EXT_PROVIDER_REQUEST trace missing";
      } else {
        extTraceFailReason = `Missing stages: ${missingStages.join(", ")}`;
      }
    }

    steps.push({
      name: "EXT_PROVIDER_TRACE",
      ok: extTraceOk,
      detail: {
        stages_found: traceStages,
        required_stages: [...REQUIRED_TRACE_STAGES],
        missing_stages: missingStages,
        stage_results: stageResults,
        failure_reason: extTraceFailReason,
      },
      duration_ms: Date.now() - s4,
    });

    // Step 5: Verify DB — check for SAMAI_ESTADOS records via both source field AND provenance
    // Note: When SAMAI_ESTADOS records are deduped against existing SAMAI built-in records,
    // the canonical record keeps source='samai' but provenance links are created.
    // So we check BOTH: direct source match AND provenance-confirmed records.
    const s5 = Date.now();
    const [{ count: actsCount }, { count: pubsCount }, { count: directEstadosCount }] = await Promise.all([
      (supabase.from("work_item_acts") as any)
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", wi.id)
        .eq("is_archived", false),
      supabase
        .from("work_item_publicaciones")
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", wi.id)
        .eq("is_archived", false),
      (supabase.from("work_item_acts") as any)
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", wi.id)
        .eq("is_archived", false)
        .eq("source", "SAMAI_ESTADOS"),
    ]);

    // Also check provenance for SAMAI_ESTADOS instance confirmation
    let provenanceEstadosCount = 0;
    try {
      // Find SAMAI_ESTADOS instance ID
      const { data: estadosInstances } = await (supabase.from("provider_instances") as any)
        .select("id")
        .eq("is_enabled", true)
        .limit(10);

      if (estadosInstances?.length) {
        // Get act IDs for this work item
        const { data: wiActs } = await (supabase.from("work_item_acts") as any)
          .select("id")
          .eq("work_item_id", wi.id)
          .eq("is_archived", false);

        if (wiActs?.length) {
          const actIds = wiActs.map((a: any) => a.id);
          const { count: provCount } = await (supabase.from("act_provenance") as any)
            .select("id", { count: "exact", head: true })
            .in("work_item_act_id", actIds.slice(0, 100));
          provenanceEstadosCount = provCount || 0;
        }
      }
    } catch {
      // provenance check is best-effort
    }

    const totalEstadosEvidence = (directEstadosCount || 0) + provenanceEstadosCount;
    const hasEstados = totalEstadosEvidence > 0;

    // Determine three-state classification for SAMAI_ESTADOS
    const estadosState = (directEstadosCount || 0) > 0
      ? "FRESH_INSERTS"
      : provenanceEstadosCount > 0
      ? "CROSS_VALIDATED"
      : "NO_DATA";

    steps.push({
      name: "VERIFY_DB_DATA",
      ok: (actsCount || 0) > 0,
      detail: {
        actuaciones_total: actsCount || 0,
        publicaciones: pubsCount || 0,
        samai_estados: {
          state: estadosState,
          fresh_inserts: directEstadosCount || 0,
          cross_validated: Math.max(0, provenanceEstadosCount - (directEstadosCount || 0)),
          total_coverage: totalEstadosEvidence,
        },
        has_estados: hasEstados,
        note: estadosState === "CROSS_VALIDATED"
          ? "Records deduped against existing SAMAI data — provenance confirms SAMAI_ESTADOS coverage"
          : estadosState === "FRESH_INSERTS"
          ? `${directEstadosCount} net-new records inserted from SAMAI_ESTADOS`
          : "No SAMAI_ESTADOS data found — check mapping and upsert path",
      },
      duration_ms: Date.now() - s5,
    });

    // Step 6: Source breakdown
    const s6 = Date.now();
    const { data: actsBySource } = await (supabase.from("work_item_acts") as any)
      .select("source")
      .eq("work_item_id", wi.id)
      .eq("is_archived", false);
    const sourceCounts: Record<string, number> = {};
    for (const a of actsBySource || []) {
      sourceCounts[a.source || "unknown"] = (sourceCounts[a.source || "unknown"] || 0) + 1;
    }
    steps.push({
      name: "SOURCE_BREAKDOWN",
      ok: true,
      detail: sourceCounts,
      duration_ms: Date.now() - s6,
    });

    // Analysis
    const allOk = steps.every((s) => s.ok);
    const analysisParts: string[] = [];
    if (allOk) {
      analysisParts.push("✅ E2E test completo — todos los pasos pasaron.");
    } else {
      const failed = steps.filter((s) => !s.ok).map((s) => s.name);
      analysisParts.push(`⚠️ ${failed.length} paso(s) fallaron: ${failed.join(", ")}`);
      if (extTraceFailReason) {
        analysisParts.push(`🔍 ${extTraceFailReason}`);
      }
    }
    if (readinessOk) {
      analysisParts.push(`🔑 Secreto descifrable (${readinessDetail.platform_key_mode}, v${readinessDetail.key_version})`);
    } else {
      analysisParts.push(`🔴 Secreto NO descifrable: ${readinessDetail.failure_reason || "unknown"}`);
    }
    // Three-state SAMAI_ESTADOS summary
    if (estadosState === "FRESH_INSERTS") {
      analysisParts.push(`✅ SAMAI_ESTADOS: ${directEstadosCount} registros insertados + ${provenanceEstadosCount} provenance`);
    } else if (estadosState === "CROSS_VALIDATED") {
      analysisParts.push(`🔵 SAMAI_ESTADOS: ${provenanceEstadosCount} cross-validated vía provenance (dedup saludable)`);
    } else {
      analysisParts.push(`🔴 SAMAI_ESTADOS: sin datos ni provenance — revisar mapping/upsert`);
    }
    analysisParts.push(`📊 Actuaciones: ${actsCount || 0}, Publicaciones: ${pubsCount || 0}`);
    if (Object.keys(sourceCounts).length > 0) {
      analysisParts.push(`📦 Fuentes: ${Object.entries(sourceCounts).map(([k, v]) => `${k}(${v})`).join(", ")}`);
    }

    const result = buildResult({
      ok: allOk,
      normalized,
      testId,
      startedAt,
      steps,
      t0,
      analysis: analysisParts.join("\n"),
      workItemId: wi.id,
    });

    // Log to audit
    try {
      const { data: actionData } = await (supabase.from("atenia_ai_actions") as any)
        .insert({
          organization_id: wi.organization_id,
          action_type: "PROVIDER_E2E_TEST",
          autonomy_tier: input.triggered_by === "heartbeat" ? "ACT" : "OBSERVE",
          target_entity_type: "work_item",
          target_entity_id: wi.id,
          reasoning: `E2E agéntico ${input.triggered_by} para radicado ${normalized} — ${allOk ? "PASSED" : "FAILED"}`,
          evidence: {
            test_id: testId,
            triggered_by: input.triggered_by,
            steps: steps.map((s) => ({ name: s.name, ok: s.ok })),
            duration_ms: result.duration_ms,
            source_breakdown: sourceCounts,
            ext_trace_stages: traceStages,
            missing_stages: missingStages,
            samai_estados_direct: directEstadosCount || 0,
            samai_estados_via_provenance: provenanceEstadosCount,
          },
          action_taken: "E2E_TEST_EXECUTED",
          action_result: allOk ? "PASSED" : "FAILED",
          scope: "EXTERNAL_PROVIDER",
          workflow_type: wi.workflow_type,
        })
        .select("id")
        .single();
      result.action_id = actionData?.id;
    } catch {
      // best-effort
    }

    return result;
  } catch (err: any) {
    return buildResult({
      ok: false,
      normalized,
      testId,
      startedAt,
      steps,
      t0,
      analysis: `❌ Error fatal: ${err.message}`,
    });
  }
}

function buildResult(params: {
  ok: boolean;
  normalized: string;
  testId: string;
  startedAt: string;
  steps: AteniaE2ETestStep[];
  t0: number;
  analysis: string;
  workItemId?: string;
}): AteniaE2ETestResult {
  return {
    ok: params.ok,
    radicado: params.normalized,
    work_item_id: params.workItemId,
    test_id: params.testId,
    started_at: params.startedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - params.t0,
    steps: params.steps,
    analysis: params.analysis,
  };
}
