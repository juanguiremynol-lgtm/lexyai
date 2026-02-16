/**
 * atenia-e2e-registry.ts — E2E Test Registry & Scheduled Batch Tests
 *
 * Auto-populates sentinel test items per workflow type.
 * Runs full-pipeline E2E tests every 6 hours.
 * Triggers deep dives for items with 3+ consecutive E2E failures.
 *
 * Ops Hardening A: Fail classification with fail_reason, failure_summary, failure_stage.
 * SKIPPED (not FAIL) for precondition issues.
 */

import { supabase } from "@/integrations/supabase/client";
import { runAteniaE2ETest } from "./atenia-ai-e2e-test";
import { executeDeepDive } from "./atenia-deep-dive";

// ─── E2E Fail Reasons ───
export type E2EFailReason =
  | "ITEM_NOT_FOUND"
  | "SENTINEL_NOT_CONFIGURED"
  | "PROVIDER_PRECONDITION_FAILED"
  | "PROVIDER_TIMEOUT"
  | "SYNC_TIMEOUT"
  | "ASSERTION_FAILED"
  | "NO_EXTERNAL_DATA_YET"
  | "UNKNOWN_ERROR";

export type E2EFailureStage =
  | "PRECHECK"
  | "ENQUEUE"
  | "FETCH"
  | "NORMALIZE"
  | "PERSIST"
  | "VERIFY";

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

/**
 * Refresh the E2E test registry — ensure at least 1 sentinel per workflow type.
 */
export async function refreshE2ERegistry(orgId: string): Promise<number> {
  const { data: workItems } = await (supabase.from("work_items") as any)
    .select("id, radicado, workflow_type, last_successful_sync_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null);

  if (!workItems || workItems.length === 0) return 0;

  const byType = new Map<string, typeof workItems>();
  for (const item of workItems) {
    const list = byType.get(item.workflow_type) ?? [];
    list.push(item);
    byType.set(item.workflow_type, list);
  }

  let sentinelsAdded = 0;

  for (const [wfType, items] of byType) {
    const { data: existing } = await (supabase.from("atenia_e2e_test_registry") as any)
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

    await (supabase.from("atenia_e2e_test_registry") as any).insert({
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
    try {
      await (supabase.from("atenia_ai_actions") as any).insert({
        organization_id: orgId,
        action_type: "REFRESH_E2E_REGISTRY",
        actor: "AI_AUTOPILOT",
        autonomy_tier: "ACT",
        reasoning: `Registro E2E actualizado: ${sentinelsAdded} nuevos centinelas añadidos.`,
        action_result: "applied",
        status: "EXECUTED",
        evidence: { sentinels_added: sentinelsAdded },
      });
    } catch { /* best-effort */ }
  }

  return sentinelsAdded;
}

/**
 * Classify E2E failure — determine fail_reason, failure_summary, failure_stage.
 */
function classifyE2EFailure(result: any, testMeta: { is_sentinel: boolean; radicado: string }): {
  fail_reason: E2EFailReason;
  failure_summary: string;
  failure_stage: E2EFailureStage;
} {
  const steps = result.steps ?? [];

  // Check FIND_WORK_ITEM step
  const findStep = steps.find((s: any) => s.name === "FIND_WORK_ITEM");
  if (findStep && !findStep.ok) {
    return {
      fail_reason: "ITEM_NOT_FOUND",
      failure_summary: `Work item para radicado ${testMeta.radicado} no encontrado en BD.`,
      failure_stage: "PRECHECK",
    };
  }

  // Check SECRET_READINESS
  const secretStep = steps.find((s: any) => s.name === "SECRET_READINESS");
  if (secretStep && !secretStep.ok) {
    return {
      fail_reason: "PROVIDER_PRECONDITION_FAILED",
      failure_summary: `Secreto del proveedor no disponible: ${secretStep.detail?.failure_reason || secretStep.detail?.error || "unknown"}.`.slice(0, 280),
      failure_stage: "PRECHECK",
    };
  }

  // Check SYNC_BY_WORK_ITEM
  const syncStep = steps.find((s: any) => s.name === "SYNC_BY_WORK_ITEM");
  if (syncStep && !syncStep.ok) {
    const detail = syncStep.detail || {};
    if (detail.error?.includes("timeout") || detail.error?.includes("Timeout")) {
      return { fail_reason: "SYNC_TIMEOUT", failure_summary: `Sync timeout: ${detail.error}`.slice(0, 280), failure_stage: "FETCH" };
    }
    return {
      fail_reason: "PROVIDER_PRECONDITION_FAILED",
      failure_summary: `Sync falló: ${detail.error || detail.status || "unknown"}`.slice(0, 280),
      failure_stage: "ENQUEUE",
    };
  }

  // Check EXT_PROVIDER_TRACE
  const traceStep = steps.find((s: any) => s.name === "EXT_PROVIDER_TRACE");
  if (traceStep && !traceStep.ok) {
    const missing = traceStep.detail?.missing_stages ?? [];
    if (missing.length > 0) {
      return {
        fail_reason: "PROVIDER_PRECONDITION_FAILED",
        failure_summary: `Stages faltantes: ${missing.join(", ")}`.slice(0, 280),
        failure_stage: "NORMALIZE",
      };
    }
  }

  // Check VERIFY_DB_DATA
  const dbStep = steps.find((s: any) => s.name === "VERIFY_DB_DATA");
  if (dbStep && !dbStep.ok) {
    const acts = dbStep.detail?.actuaciones_total ?? 0;
    if (acts === 0) {
      return {
        fail_reason: "NO_EXTERNAL_DATA_YET",
        failure_summary: `Sin actuaciones en BD tras sync — posible radicado sin datos públicos aún.`,
        failure_stage: "VERIFY",
      };
    }
    return {
      fail_reason: "ASSERTION_FAILED",
      failure_summary: `Verificación de datos falló: ${acts} actuaciones.`,
      failure_stage: "VERIFY",
    };
  }

  return {
    fail_reason: "UNKNOWN_ERROR",
    failure_summary: `Fallo no clasificado. Pasos fallidos: ${steps.filter((s: any) => !s.ok).map((s: any) => s.name).join(", ")}`.slice(0, 280),
    failure_stage: "VERIFY",
  };
}

/**
 * Determine if a failure is a precondition issue (should be SKIPPED not FAIL).
 */
function isPreconditionFailure(failReason: E2EFailReason): boolean {
  return ["ITEM_NOT_FOUND", "SENTINEL_NOT_CONFIGURED", "PROVIDER_PRECONDITION_FAILED", "NO_EXTERNAL_DATA_YET"].includes(failReason);
}

/**
 * Run scheduled E2E tests on sentinel items + 2 rotating stalest items.
 */
export async function runScheduledE2EBatch(
  orgId: string,
  trigger: "SCHEDULED" | "PRE_DAILY_SYNC"
): Promise<{ passed: number; failed: number; skipped: number; total: number }> {
  // Get sentinel items
  const { data: sentinels } = await (supabase.from("atenia_e2e_test_registry") as any)
    .select("*")
    .eq("organization_id", orgId)
    .eq("is_sentinel", true);

  // Get 2 rotating stalest items
  const { data: staleItems } = await (supabase.from("work_items") as any)
    .select("id, radicado, workflow_type")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null)
    .order("last_successful_sync_at", { ascending: true, nullsFirst: true })
    .limit(2);

  const sentinelIds = new Set((sentinels ?? []).map((s: any) => s.work_item_id));
  const testRadicados: Array<{ radicado: string; work_item_id: string; is_sentinel: boolean }> = [];

  for (const s of sentinels ?? []) {
    testRadicados.push({ radicado: s.radicado, work_item_id: s.work_item_id, is_sentinel: true });
  }

  for (const item of staleItems ?? []) {
    if (!sentinelIds.has(item.id)) {
      testRadicados.push({ radicado: item.radicado, work_item_id: item.id, is_sentinel: false });
    }
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const test of testRadicados) {
    try {
      // Verify work item exists before running (precondition check)
      const { data: wiCheck } = await (supabase.from("work_items") as any)
        .select("id")
        .eq("id", test.work_item_id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!wiCheck) {
        // SKIPPED: sentinel maps to missing work item
        await persistE2EResult(orgId, test, trigger, sentinels, {
          overall: "SKIPPED",
          fail_reason: "ITEM_NOT_FOUND",
          failure_summary: `Work item ${test.work_item_id} no encontrado o eliminado.`,
          failure_stage: "PRECHECK",
          steps: [],
          duration_ms: 0,
        });
        skipped++;
        continue;
      }

      const result = await runAteniaE2ETest({
        radicado: test.radicado,
        triggered_by: "heartbeat",
      });

      if (result.ok) {
        await persistE2EResult(orgId, test, trigger, sentinels, {
          overall: "ALL_PASS",
          steps: result.steps,
          duration_ms: result.duration_ms,
          started_at: result.started_at,
          finished_at: result.completed_at,
        });
        passed++;

        if (test.is_sentinel) {
          await (supabase.from("atenia_e2e_test_registry") as any)
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "ALL_PASS", consecutive_failures: 0 })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
        }
      } else {
        const classification = classifyE2EFailure(result, test);
        const isPrecon = isPreconditionFailure(classification.fail_reason);
        const overall = isPrecon ? "SKIPPED" : "FAIL";

        await persistE2EResult(orgId, test, trigger, sentinels, {
          overall,
          fail_reason: classification.fail_reason,
          failure_summary: classification.failure_summary,
          failure_stage: classification.failure_stage,
          steps: result.steps,
          duration_ms: result.duration_ms,
          started_at: result.started_at,
          finished_at: result.completed_at,
        });

        if (isPrecon) {
          skipped++;
        } else {
          failed++;
        }

        if (test.is_sentinel) {
          const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
          const newConsecutive = isPrecon ? (registryEntry?.consecutive_failures ?? 0) : (registryEntry?.consecutive_failures ?? 0) + 1;
          await (supabase.from("atenia_e2e_test_registry") as any)
            .update({
              last_tested_at: new Date().toISOString(),
              last_test_result: overall,
              consecutive_failures: newConsecutive,
            })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);

          if (!isPrecon && newConsecutive >= 3) {
            await executeDeepDive(orgId, test.work_item_id, "E2E_SENTINEL_FAILURE", {
              consecutive_e2e_failures: newConsecutive,
              last_test_steps: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
              fail_reason: classification.fail_reason,
            });
          }
        }
      }
    } catch { /* non-blocking per item */ }
  }

  // Log batch action
  try {
    await (supabase.from("atenia_ai_actions") as any).insert({
      organization_id: orgId,
      action_type: "SCHEDULED_E2E_BATCH",
      actor: "AI_AUTOPILOT",
      autonomy_tier: "ACT",
      reasoning: `E2E programado (${trigger}): ${passed}✅ ${failed}❌ ${skipped}⏭ de ${testRadicados.length} asuntos.`,
      action_result: failed === 0 ? "applied" : "partial",
      status: "EXECUTED",
      evidence: { trigger, total: testRadicados.length, passed, failed, skipped },
    });
  } catch { /* best-effort */ }

  return { passed, failed, skipped, total: testRadicados.length };
}

// ─── Helpers ───

async function persistE2EResult(
  orgId: string,
  test: { radicado: string; work_item_id: string; is_sentinel: boolean },
  trigger: string,
  sentinels: any[] | null,
  data: {
    overall: string;
    fail_reason?: string;
    failure_summary?: string;
    failure_stage?: string;
    steps: any[];
    duration_ms: number;
    started_at?: string;
    finished_at?: string;
  }
): Promise<void> {
  const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
  await (supabase.from("atenia_e2e_test_results") as any).insert({
    organization_id: orgId,
    registry_id: registryEntry?.id ?? null,
    work_item_id: test.work_item_id,
    radicado: test.radicado,
    workflow_type: registryEntry?.workflow_type ?? "unknown",
    trigger,
    overall: data.overall,
    fail_reason: data.fail_reason ?? null,
    failure_summary: data.failure_summary ?? null,
    failure_stage: data.failure_stage ?? null,
    steps: data.steps,
    duration_ms: data.duration_ms,
    started_at: data.started_at ?? new Date().toISOString(),
    finished_at: data.finished_at ?? new Date().toISOString(),
  });
}
