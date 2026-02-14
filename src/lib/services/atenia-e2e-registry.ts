/**
 * atenia-e2e-registry.ts — E2E Test Registry & Scheduled Batch Tests
 *
 * Auto-populates sentinel test items per workflow type.
 * Runs full-pipeline E2E tests every 6 hours.
 * Triggers deep dives for items with 3+ consecutive E2E failures.
 */

import { supabase } from "@/integrations/supabase/client";
import { runAteniaE2ETest } from "./atenia-ai-e2e-test";
import { executeDeepDive } from "./atenia-deep-dive";

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
 * Runs once per day (during platform sweep or daily sync start).
 */
export async function refreshE2ERegistry(orgId: string): Promise<number> {
  const { data: workItems } = await (supabase.from("work_items") as any)
    .select("id, radicado, workflow_type, last_successful_sync_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .is("deleted_at", null);

  if (!workItems || workItems.length === 0) return 0;

  // Group by workflow_type
  const byType = new Map<string, typeof workItems>();
  for (const item of workItems) {
    const list = byType.get(item.workflow_type) ?? [];
    list.push(item);
    byType.set(item.workflow_type, list);
  }

  let sentinelsAdded = 0;

  for (const [wfType, items] of byType) {
    // Check if we already have a sentinel for this type
    const { data: existing } = await (supabase.from("atenia_e2e_test_registry") as any)
      .select("id")
      .eq("organization_id", orgId)
      .eq("workflow_type", wfType)
      .eq("is_sentinel", true)
      .limit(1)
      .maybeSingle();

    if (existing) continue;

    // Pick best candidate (most recent successful sync)
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
 * Run scheduled E2E tests on sentinel items + 2 rotating stalest items.
 * Returns number of tests executed.
 */
export async function runScheduledE2EBatch(
  orgId: string,
  trigger: "SCHEDULED" | "PRE_DAILY_SYNC"
): Promise<{ passed: number; failed: number; total: number }> {
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

  // Add sentinels
  for (const s of sentinels ?? []) {
    testRadicados.push({ radicado: s.radicado, work_item_id: s.work_item_id, is_sentinel: true });
  }

  // Add stale items (avoid duplicates with sentinels)
  for (const item of staleItems ?? []) {
    if (!sentinelIds.has(item.id)) {
      testRadicados.push({ radicado: item.radicado, work_item_id: item.id, is_sentinel: false });
    }
  }

  let passed = 0;
  let failed = 0;

  for (const test of testRadicados) {
    try {
      const result = await runAteniaE2ETest({
        radicado: test.radicado,
        triggered_by: "heartbeat",
      });

      // Store result
      const registryEntry = (sentinels ?? []).find((s: any) => s.work_item_id === test.work_item_id);
      await (supabase.from("atenia_e2e_test_results") as any).insert({
        organization_id: orgId,
        registry_id: registryEntry?.id ?? null,
        work_item_id: test.work_item_id,
        radicado: test.radicado,
        workflow_type: result.work_item_id ? "detected" : "unknown",
        trigger,
        overall: result.ok ? "ALL_PASS" : "FAIL",
        steps: result.steps,
        duration_ms: result.duration_ms,
        started_at: result.started_at,
        finished_at: result.completed_at,
      });

      if (result.ok) {
        passed++;
        // Reset consecutive failures for sentinel
        if (test.is_sentinel) {
          await (supabase.from("atenia_e2e_test_registry") as any)
            .update({ last_tested_at: new Date().toISOString(), last_test_result: "ALL_PASS", consecutive_failures: 0 })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);
        }
      } else {
        failed++;
        if (test.is_sentinel && registryEntry) {
          const newConsecutive = (registryEntry.consecutive_failures ?? 0) + 1;
          await (supabase.from("atenia_e2e_test_registry") as any)
            .update({
              last_tested_at: new Date().toISOString(),
              last_test_result: "FAIL",
              consecutive_failures: newConsecutive,
            })
            .eq("work_item_id", test.work_item_id)
            .eq("organization_id", orgId);

          // Trigger deep dive if 3+ consecutive failures
          if (newConsecutive >= 3) {
            await executeDeepDive(orgId, test.work_item_id, "E2E_SENTINEL_FAILURE", {
              consecutive_e2e_failures: newConsecutive,
              last_test_steps: result.steps.map((s) => ({ name: s.name, ok: s.ok })),
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
      reasoning: `E2E programado (${trigger}): ${passed}✅ ${failed}❌ de ${testRadicados.length} asuntos.${failed > 0 ? ` Fallidos: ${testRadicados.filter((_, i) => i >= passed).map((t) => t.radicado).join(", ")}.` : " Todos los pipelines verificados correctamente."}`,
      action_result: failed === 0 ? "applied" : "partial",
      status: "EXECUTED",
      evidence: { trigger, total: testRadicados.length, passed, failed },
    });
  } catch { /* best-effort */ }

  return { passed, failed, total: testRadicados.length };
}
