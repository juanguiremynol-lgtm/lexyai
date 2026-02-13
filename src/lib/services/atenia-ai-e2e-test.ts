/**
 * Atenia AI E2E Test Runner
 * 
 * Provides a programmatic interface for Atenia AI to agentically
 * test external provider sync pipelines end-to-end.
 * All results are logged to atenia_ai_actions for audit.
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

/**
 * Run a full E2E test for a work item identified by radicado.
 * Steps: FIND_WORK_ITEM → SECRET_READINESS → SYNC → EXT_TRACE → VERIFY_DB → SOURCE_BREAKDOWN
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

    // Step 2: Secret readiness for all external connectors
    const s2 = Date.now();
    let readinessOk = true;
    let readinessDetail: any = {};
    try {
      const { data: connectors } = await (supabase.from("provider_connectors") as any)
        .select("id, name")
        .eq("is_enabled", true);

      for (const c of connectors || []) {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/provider-secret-readiness?connector_id=${encodeURIComponent(c.id)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          }
        );
        const data = await resp.json();
        readinessDetail[c.name] = { can_decrypt: data.can_decrypt, status: data.status, key_mode: data.platform_key_mode };
        if (!data.can_decrypt) readinessOk = false;
      }
    } catch (err: any) {
      readinessOk = false;
      readinessDetail.error = err.message;
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

    // Step 4: Check external provider traces
    const s4 = Date.now();
    const { data: traces } = await (supabase.from("provider_sync_traces") as any)
      .select("stage, ok, result_code, latency_ms, created_at")
      .eq("work_item_id", wi.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const latestExtTrace = traces?.[0];
    steps.push({
      name: "EXT_PROVIDER_TRACE",
      ok: latestExtTrace?.ok === true,
      detail: latestExtTrace || { message: "No external provider traces" },
      duration_ms: Date.now() - s4,
    });

    // Step 5: Verify DB
    const s5 = Date.now();
    const [{ count: actsCount }, { count: pubsCount }] = await Promise.all([
      (supabase.from("work_item_acts") as any)
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", wi.id)
        .eq("is_archived", false),
      supabase
        .from("work_item_publicaciones")
        .select("id", { count: "exact", head: true })
        .eq("work_item_id", wi.id)
        .eq("is_archived", false),
    ]);
    steps.push({
      name: "VERIFY_DB_DATA",
      ok: (actsCount || 0) > 0,
      detail: { actuaciones: actsCount || 0, publicaciones: pubsCount || 0 },
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
