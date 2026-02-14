/**
 * atenia-e2e-scheduled — Server-side scheduled E2E pipeline tests.
 *
 * Runs full-pipeline E2E tests on sentinel + rotating work items.
 * Also handles E2E registry refresh (sentinel auto-selection).
 *
 * Modes:
 *   - E2E_BATCH: Run scheduled E2E tests (every 6h or pre-daily-sync)
 *   - REFRESH_REGISTRY: Ensure sentinel coverage per workflow type
 *   - FULL: Both (default)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { logAction } from "../_shared/action-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Provider coverage matrix per workflow type */
const PROVIDERS_FOR_TYPE: Record<string, string[]> = {
  CPACA: ["CPNU", "SAMAI", "PUBLICACIONES", "SAMAI_ESTADOS"],
  CGP: ["CPNU", "PUBLICACIONES"],
  Laboral: ["CPNU", "SAMAI", "PUBLICACIONES"],
  Penal: ["CPNU", "PUBLICACIONES"],
  PENAL_906: ["CPNU", "PUBLICACIONES"],
  Tutelas: ["TUTELAS", "PUBLICACIONES"],
  "Proceso Administrativo": ["SAMAI", "PUBLICACIONES"],
  Peticiones: ["CPNU"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "atenia-e2e-scheduled" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: {
    organization_id?: string;
    mode?: "E2E_BATCH" | "REFRESH_REGISTRY" | "FULL";
    trigger?: "SCHEDULED" | "PRE_DAILY_SYNC";
  } = {};
  try { body = await req.json(); } catch { /* no body */ }

  const mode = body.mode ?? "FULL";
  const trigger = body.trigger ?? "SCHEDULED";
  const startTime = Date.now();

  try {
    // Determine orgs
    let orgIds: string[];
    if (body.organization_id) {
      orgIds = [body.organization_id];
    } else {
      const { data: orgRows } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .not("organization_id", "is", null);
      orgIds = [...new Set((orgRows ?? []).map((r: any) => r.organization_id).filter(Boolean))];
    }

    const allResults: any[] = [];

    for (const orgId of orgIds) {
      // Budget check: 120s max
      if (Date.now() - startTime > 120_000) break;

      try {
        let registryResult: any = null;
        let e2eResult: any = null;

        // REFRESH_REGISTRY
        if (mode === "REFRESH_REGISTRY" || mode === "FULL") {
          registryResult = await refreshE2ERegistry(supabase, orgId);
        }

        // E2E_BATCH
        if (mode === "E2E_BATCH" || mode === "FULL") {
          e2eResult = await runScheduledE2EBatch(supabase, orgId, trigger);
        }

        allResults.push({ org_id: orgId, registry: registryResult, e2e: e2eResult });
      } catch (err) {
        allResults.push({ org_id: orgId, error: (err as Error).message });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, duration_ms: Date.now() - startTime, results: allResults }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Registry Refresh ───

async function refreshE2ERegistry(supabase: any, orgId: string): Promise<{ sentinels_added: number }> {
  const { data: workItems } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, last_successful_sync_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null);

  if (!workItems || workItems.length === 0) return { sentinels_added: 0 };

  const byType = new Map<string, typeof workItems>();
  for (const item of workItems) {
    const list = byType.get(item.workflow_type) ?? [];
    list.push(item);
    byType.set(item.workflow_type, list);
  }

  let sentinelsAdded = 0;

  for (const [wfType, items] of byType) {
    const { data: existing } = await supabase
      .from("atenia_e2e_test_registry")
      .select("id")
      .eq("organization_id", orgId)
      .eq("workflow_type", wfType)
      .eq("is_sentinel", true)
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    const sorted = items
      .filter((i: any) => i.last_successful_sync_at)
      .sort((a: any, b: any) =>
        new Date(b.last_successful_sync_at).getTime() - new Date(a.last_successful_sync_at).getTime()
      );
    const candidate = sorted[0] ?? items[0];
    if (!candidate) continue;

    await supabase.from("atenia_e2e_test_registry").insert({
      organization_id: orgId,
      work_item_id: candidate.id,
      radicado: candidate.radicado,
      workflow_type: candidate.workflow_type,
      providers_to_test: PROVIDERS_FOR_TYPE[candidate.workflow_type] ?? ["CPNU", "PUBLICACIONES"],
      is_sentinel: true,
    });
    sentinelsAdded++;
  }

  if (sentinelsAdded > 0) {
    await logAction(supabase, {
      action_type: "REFRESH_E2E_REGISTRY",
      actor: "AI_AUTOPILOT",
      scope: "ORG",
      organization_id: orgId,
      autonomy_tier: "ACT",
      reasoning: `Registro E2E actualizado: ${sentinelsAdded} nuevos centinelas añadidos.`,
      action_result: "applied",
      status: "EXECUTED",
      evidence: { sentinels_added: sentinelsAdded },
    });
  }

  return { sentinels_added: sentinelsAdded };
}

// ─── E2E Batch Runner ───

async function runScheduledE2EBatch(
  supabase: any,
  orgId: string,
  trigger: string
): Promise<{ passed: number; failed: number; total: number }> {
  // Get sentinel items
  const { data: sentinels } = await supabase
    .from("atenia_e2e_test_registry")
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_sentinel", true);

  // Get 2 stalest rotating items
  const { data: staleItems } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .order("last_successful_sync_at", { ascending: true, nullsFirst: true })
    .limit(2);

  const sentinelIds = new Set((sentinels ?? []).map((s: any) => s.work_item_id));
  const testItems: Array<{ radicado: string; work_item_id: string; is_sentinel: boolean }> = [];

  for (const s of sentinels ?? []) {
    testItems.push({ radicado: s.radicado, work_item_id: s.work_item_id, is_sentinel: true });
  }
  for (const item of staleItems ?? []) {
    if (!sentinelIds.has(item.id)) {
      testItems.push({ radicado: item.radicado, work_item_id: item.id, is_sentinel: false });
    }
  }

  let passed = 0;
  let failed = 0;

  for (const test of testItems) {
    try {
      const result = await executeServerE2E(supabase, test.work_item_id, test.radicado);

      // Store result
      const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
      await supabase.from("atenia_e2e_test_results").insert({
        organization_id: orgId,
        registry_id: registryEntry?.id ?? null,
        work_item_id: test.work_item_id,
        radicado: test.radicado,
        workflow_type: result.workflow_type ?? "unknown",
        trigger,
        overall: result.ok ? "ALL_PASS" : "FAIL",
        steps: result.steps,
        duration_ms: result.duration_ms,
        started_at: result.started_at,
        finished_at: result.finished_at,
      });

      if (result.ok) {
        passed++;
        if (test.is_sentinel) {
          await supabase.from("atenia_e2e_test_registry")
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "ALL_PASS", consecutive_failures: 0 })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
        }
      } else {
        failed++;
        if (test.is_sentinel && registryEntry) {
          const newConsecutive = (registryEntry.consecutive_failures ?? 0) + 1;
          await supabase.from("atenia_e2e_test_registry")
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "FAIL", consecutive_failures: newConsecutive })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);

          // Trigger deep dive on 3+ consecutive failures
          if (newConsecutive >= 3) {
            await triggerDeepDive(supabase, orgId, test.work_item_id, "E2E_SENTINEL_FAILURE", {
              consecutive_e2e_failures: newConsecutive,
              last_steps: result.steps.map((s: any) => ({ name: s.name, ok: s.ok })),
            });
          }
        }
      }
    } catch { /* non-blocking per item */ }
  }

  // Log batch action
  await logAction(supabase, {
    action_type: "SCHEDULED_E2E_BATCH",
    actor: "AI_AUTOPILOT",
    scope: "ORG",
    organization_id: orgId,
    autonomy_tier: "ACT",
    reasoning: `E2E programado (${trigger}): ${passed}✅ ${failed}❌ de ${testItems.length} asuntos.${failed > 0 ? " Fallos detectados." : " Todos OK."}`,
    action_result: failed === 0 ? "applied" : "partial",
    status: "EXECUTED",
    evidence: { trigger, total: testItems.length, passed, failed },
  });

  return { passed, failed, total: testItems.length };
}

// ─── Single E2E Execution (server-side, uses service role) ───

async function executeServerE2E(
  supabase: any,
  workItemId: string,
  radicado: string
): Promise<{ ok: boolean; steps: any[]; duration_ms: number; started_at: string; finished_at: string; workflow_type?: string }> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const steps: Array<{ name: string; ok: boolean; latency_ms: number; detail?: any; error?: string }> = [];

  // Step 1: Find work item
  const s1 = Date.now();
  const { data: item, error: wiErr } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, monitoring_enabled, deleted_at, last_successful_sync_at")
    .eq("id", workItemId)
    .single();

  steps.push({
    name: "FIND_WORK_ITEM",
    ok: !!item && !wiErr && !item?.deleted_at,
    latency_ms: Date.now() - s1,
    error: wiErr?.message || (item?.deleted_at ? "Soft-deleted" : undefined),
  });

  if (!item || wiErr) {
    return { ok: false, steps, duration_ms: Date.now() - t0, started_at: startedAt, finished_at: new Date().toISOString() };
  }

  // Step 2: Sync acts
  const s2 = Date.now();
  try {
    const { error: syncErr } = await supabase.functions.invoke("sync-by-work-item", {
      body: { work_item_id: workItemId, trigger: "E2E_TEST" },
    });
    steps.push({ name: "SYNC_ACTS", ok: !syncErr, latency_ms: Date.now() - s2, error: syncErr?.message });
  } catch (err) {
    steps.push({ name: "SYNC_ACTS", ok: false, latency_ms: Date.now() - s2, error: (err as Error).message });
  }

  // Step 3: Sync publicaciones
  const s3 = Date.now();
  try {
    const { error: pubErr } = await supabase.functions.invoke("sync-publicaciones-by-work-item", {
      body: { work_item_id: workItemId, trigger: "E2E_TEST" },
    });
    steps.push({ name: "SYNC_PUBS", ok: !pubErr, latency_ms: Date.now() - s3, error: pubErr?.message });
  } catch (err) {
    steps.push({ name: "SYNC_PUBS", ok: false, latency_ms: Date.now() - s3, error: (err as Error).message });
  }

  // Step 4: Verify data in canonical tables
  const s4 = Date.now();
  const [{ count: actCount }, { count: pubCount }] = await Promise.all([
    supabase.from("work_item_acts").select("id", { count: "exact", head: true }).eq("work_item_id", workItemId),
    supabase.from("work_item_publicaciones").select("id", { count: "exact", head: true }).eq("work_item_id", workItemId),
  ]);
  steps.push({
    name: "VERIFY_DB_DATA",
    ok: (actCount ?? 0) > 0 || (pubCount ?? 0) > 0,
    latency_ms: Date.now() - s4,
    detail: { actuaciones: actCount ?? 0, publicaciones: pubCount ?? 0 },
    error: (actCount ?? 0) === 0 && (pubCount ?? 0) === 0 ? "No data in canonical tables" : undefined,
  });

  // Step 5: Source breakdown
  const s5 = Date.now();
  const { data: sources } = await supabase
    .from("work_item_acts")
    .select("source")
    .eq("work_item_id", workItemId);
  const breakdown: Record<string, number> = {};
  for (const row of sources ?? []) {
    breakdown[row.source ?? "unknown"] = (breakdown[row.source ?? "unknown"] ?? 0) + 1;
  }
  steps.push({
    name: "SOURCE_BREAKDOWN",
    ok: Object.keys(breakdown).length > 0,
    latency_ms: Date.now() - s5,
    detail: breakdown,
  });

  const allOk = steps.every((s) => s.ok);
  return {
    ok: allOk,
    steps,
    duration_ms: Date.now() - t0,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    workflow_type: item.workflow_type,
  };
}

// ─── Deep Dive Trigger (server-side) ───

async function triggerDeepDive(
  supabase: any,
  orgId: string,
  workItemId: string,
  criteria: string,
  evidence: Record<string, any>
): Promise<void> {
  // Rate limit: max 1 per item per 4h
  const { data: recent } = await supabase
    .from("atenia_deep_dives")
    .select("id")
    .eq("work_item_id", workItemId)
    .gte("created_at", new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();

  if (recent) return;

  // Get work item info
  const { data: item } = await supabase
    .from("work_items")
    .select("radicado")
    .eq("id", workItemId)
    .single();

  await supabase.from("atenia_deep_dives").insert({
    organization_id: orgId,
    work_item_id: workItemId,
    radicado: item?.radicado ?? "",
    trigger_criteria: criteria,
    trigger_evidence: evidence,
    status: "RUNNING",
    diagnosis: `Deep dive pendiente — activado por ${criteria}`,
    severity: "HIGH",
  });

  await logAction(supabase, {
    action_type: "TRIGGER_DEEP_DIVE",
    actor: "AI_AUTOPILOT",
    scope: "ORG",
    organization_id: orgId,
    work_item_id: workItemId,
    autonomy_tier: "ACT",
    reasoning: `Deep dive activado para ${item?.radicado ?? workItemId}: ${criteria}.`,
    action_result: "triggered",
    status: "EXECUTED",
    evidence,
  });
}
