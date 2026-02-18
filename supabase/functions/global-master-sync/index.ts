/**
 * global-master-sync — Server-side Global Master Sync (super admin override).
 *
 * Runs with service role, writes platform_job_heartbeats start/finish,
 * processes eligible work items within a 120s execution budget.
 * If budget exhausted, finishes with partial results.
 *
 * POST { _scheduled?: boolean }
 *
 * Release-gate mode (deterministic failure injection):
 *   POST { release_gate: { force_timeout_provider: "SAMAI_ESTADOS", force_once: true } }
 *   Injects a single EDGE_FORCED_TIMEOUT attempt for the specified provider
 *   on the first eligible item, so ops can verify attempt → incident → heartbeat pipeline.
 *
 * Returns: { ok, total, success, failed, empty_results, skipped, duration_ms, budget_exhausted, failed_items }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  startHeartbeat,
  finishHeartbeat,
} from "../_shared/platformJobHeartbeat.ts";
import {
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
} from "../_shared/syncPolicy.ts";

const JOB_NAME = "global-master-sync";
const BUDGET_MS = 120_000; // 120s budget within 150s limit
const INTER_ITEM_DELAY_MS = 300;
const PER_ITEM_TIMEOUT_MS = 15_000; // 15s max per item pair
const MAX_FAILED_ITEMS_IN_META = 20; // Truncate for heartbeat payload size

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Types ───────────────────────────────────────────────────────────

interface FailedItem {
  work_item_id: string;
  radicado: string;
  error_code: string;
  http_code?: number;
  error_message?: string;
}

interface ReleaseGateConfig {
  force_timeout_provider: string;
  force_once?: boolean; // default true
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Record an invocation-level failure as external_sync_runs + attempts row */
async function recordInvocationFailure(
  admin: any,
  item: { id: string; radicado: string; organization_id: string },
  errorCode: string,
  errorMessage: string,
  latencyMs: number,
  httpCode?: number,
): Promise<void> {
  try {
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Write sync run
    const { error: runErr } = await admin.from("external_sync_runs").insert({
      id: runId,
      work_item_id: item.id,
      organization_id: item.organization_id,
      invoked_by: "MANUAL",
      started_at: now,
      finished_at: now,
      status: "FAILED",
      error_code: errorCode,
      error_message: errorMessage,
      duration_ms: latencyMs,
      trigger_source: "global-master-sync",
    });
    if (runErr) {
      console.error(`[${JOB_NAME}] Failed to write sync run for ${item.id}:`, JSON.stringify(runErr));
      return;
    }

    // Write synthetic attempt so dashboards see the failure
    const { error: attemptErr } = await admin.from("external_sync_run_attempts").insert({
      sync_run_id: runId,
      provider: "ORCHESTRATOR",
      data_kind: "ACTUACIONES",
      role: "PRIMARY",
      status: "error",
      error_code: errorCode,
      error_message: errorMessage,
      http_code: httpCode ?? null,
      latency_ms: latencyMs,
      recorded_at: now,
    });
    if (attemptErr) {
      console.error(`[${JOB_NAME}] Failed to write attempt for ${item.id}:`, JSON.stringify(attemptErr));
    }
  } catch (err) {
    console.warn(`[${JOB_NAME}] Failed to record invocation failure for ${item.id}:`, err);
  }
}

/** Handle release-gate forced timeout injection */
async function injectReleaseGateTimeout(
  admin: any,
  item: { id: string; radicado: string; organization_id: string },
  provider: string,
): Promise<void> {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: runErr } = await admin.from("external_sync_runs").insert({
    id: runId,
    work_item_id: item.id,
    organization_id: item.organization_id,
    invoked_by: "MANUAL",
    started_at: now,
    finished_at: now,
    status: "FAILED",
    error_code: "RELEASE_GATE_FORCED_TIMEOUT",
    error_message: `Deterministic timeout injected for provider ${provider} (release gate)`,
    duration_ms: PER_ITEM_TIMEOUT_MS,
    trigger_source: "global-master-sync-release-gate",
  });
  if (runErr) {
    console.error(`[${JOB_NAME}] [RELEASE_GATE] Failed to write sync run:`, JSON.stringify(runErr));
    throw runErr;
  }

  const { error: attemptErr } = await admin.from("external_sync_run_attempts").insert({
    sync_run_id: runId,
    provider: provider,
    data_kind: "ACTUACIONES",
    role: "PRIMARY",
    status: "timeout",
    error_code: "RELEASE_GATE_FORCED_TIMEOUT",
    error_message: `Forced timeout for release gate validation`,
    http_code: null,
    latency_ms: PER_ITEM_TIMEOUT_MS,
    recorded_at: now,
  });
  if (attemptErr) {
    console.error(`[${JOB_NAME}] [RELEASE_GATE] Failed to write attempt:`, JSON.stringify(attemptErr));
  }

  console.log(`[${JOB_NAME}] [RELEASE_GATE] Injected forced timeout: provider=${provider}, work_item=${item.id}`);
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.health_check) {
    return new Response(JSON.stringify({ ok: true, job: JOB_NAME }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse release-gate config
  const releaseGate = body.release_gate as ReleaseGateConfig | undefined;
  const releaseGateForceOnce = releaseGate?.force_once !== false; // default true
  let releaseGateFired = false;

  if (releaseGate) {
    console.log(`[${JOB_NAME}] [RELEASE_GATE] Active: force_timeout_provider=${releaseGate.force_timeout_provider}, force_once=${releaseGateForceOnce}`);
  }

  const t0 = Date.now();
  const hb = await startHeartbeat(admin, JOB_NAME, "manual_ui", {
    trigger: "GlobalMasterSyncButton",
    release_gate: releaseGate ? { provider: releaseGate.force_timeout_provider } : undefined,
  });

  try {
    const { data: items, error: itemsErr } = await admin
      .from("work_items")
      .select("id, workflow_type, radicado, stage, organization_id")
      .eq("monitoring_enabled", true)
      .is("deleted_at", null)
      .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
      .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
      .not("radicado", "is", null)
      .not("organization_id", "is", null)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(5000);

    if (itemsErr) throw itemsErr;

    const eligible = (items || []).filter(
      (i: any) => i.radicado && i.radicado.replace(/\D/g, "").length === 23
    );

    if (eligible.length === 0) {
      const meta = { total: 0, success: 0, failed: 0, empty_results: 0, skipped: 0, duration_ms: Date.now() - t0, failed_items: [] };
      await finishHeartbeat(admin, hb, "OK", { metadata: meta });
      return new Response(JSON.stringify({ ok: true, ...meta }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // In release-gate mode, limit to 5 items total to stay well under 150s wall clock
    const maxItems = releaseGate ? 5 : eligible.length;
    const processingSet = eligible.slice(0, maxItems);

    let success = 0;
    let failed = 0;
    let processed = 0;
    let budgetExhausted = false;
    const failedItems: FailedItem[] = [];

    for (let i = 0; i < processingSet.length; i++) {
      // Budget check before each item
      if (Date.now() - t0 > BUDGET_MS) {
        budgetExhausted = true;
        console.log(`[${JOB_NAME}] Budget exhausted after ${processed} items at ${Date.now() - t0}ms`);
        break;
      }

      const item = processingSet[i];

      // ── Release-gate injection ──
      if (releaseGate && (!releaseGateForceOnce || !releaseGateFired)) {
        releaseGateFired = true;
        try {
          await injectReleaseGateTimeout(admin, item, releaseGate.force_timeout_provider);
        } catch (err: any) {
          console.warn(`[${JOB_NAME}] [RELEASE_GATE] Injection write failed:`, err);
        }
        // Count this item as failed (the timeout was injected)
        failed++;
        failedItems.push({
          work_item_id: item.id,
          radicado: item.radicado,
          error_code: "RELEASE_GATE_FORCED_TIMEOUT",
        });
        processed++;
        continue; // Skip actual sync for this item
      }

      const itemT0 = Date.now();

      try {
        // Wrap both calls in a race with per-item timeout
        const itemResult = await Promise.race([
          (async () => {
            const [actsRes, pubsRes] = await Promise.allSettled([
              admin.functions.invoke("sync-by-work-item", {
                body: { work_item_id: item.id, _scheduled: true },
              }),
              admin.functions.invoke("sync-publicaciones-by-work-item", {
                body: { work_item_id: item.id, _scheduled: true },
              }),
            ]);

            // Extract HTTP codes for telemetry
            const actOk = actsRes.status === "fulfilled" && actsRes.value.data?.ok;
            const pubOk = pubsRes.status === "fulfilled" && pubsRes.value.data?.ok;

            // Check for invocation-level errors (HTTP failures before orchestrator)
            const actHttpErr = actsRes.status === "fulfilled" && actsRes.value.error;
            const pubHttpErr = pubsRes.status === "fulfilled" && pubsRes.value.error;

            if (!actOk && !pubOk) {
              // Both failed — determine error details
              const errMsg = actHttpErr?.message || pubHttpErr?.message ||
                (actsRes.status === "rejected" ? String(actsRes.reason) : "unknown");
              return { ok: false, errorCode: "EDGE_INVOKE_FAILED", errorMessage: errMsg };
            }

            return { ok: true };
          })(),
          new Promise<{ ok: false; errorCode: string; errorMessage: string }>((_, reject) =>
            setTimeout(() => reject(new Error("ITEM_TIMEOUT")), PER_ITEM_TIMEOUT_MS)
          ),
        ]);

        if (itemResult.ok) {
          success++;
        } else {
          failed++;
          const latencyMs = Date.now() - itemT0;
          failedItems.push({
            work_item_id: item.id,
            radicado: item.radicado,
            error_code: itemResult.errorCode,
            error_message: itemResult.errorMessage,
          });
          // Record invocation-level failure as first-class telemetry
          await recordInvocationFailure(admin, item, itemResult.errorCode, itemResult.errorMessage, latencyMs);
        }
      } catch (err: any) {
        failed++;
        const latencyMs = Date.now() - itemT0;
        const errorCode = err?.message === "ITEM_TIMEOUT" ? "ITEM_TIMEOUT" : "EDGE_INVOKE_EXCEPTION";
        const errorMessage = err?.message || "unknown";
        failedItems.push({
          work_item_id: item.id,
          radicado: item.radicado,
          error_code: errorCode,
          error_message: errorMessage,
        });
        await recordInvocationFailure(admin, item, errorCode, errorMessage, latencyMs);
      }

      processed++;

      if (i < processingSet.length - 1 && Date.now() - t0 < BUDGET_MS) {
        await new Promise((r) => setTimeout(r, INTER_ITEM_DELAY_MS));
      }
    }

    const skipped = eligible.length - processed;
    const durationMs = Date.now() - t0;

    // Truncate failed_items for heartbeat payload size
    const failedItemsMeta = failedItems.slice(0, MAX_FAILED_ITEMS_IN_META);

    const meta = {
      total: eligible.length,
      success,
      failed,
      skipped,
      duration_ms: durationMs,
      budget_exhausted: budgetExhausted,
      failed_items: failedItemsMeta,
      release_gate_fired: releaseGate ? releaseGateFired : undefined,
    };

    // Status semantics: OK = clean run, ERROR = degraded or no progress
    const heartbeatStatus = (success === 0 || failed > 0 || budgetExhausted) ? "ERROR" : "OK";
    await finishHeartbeat(admin, hb, heartbeatStatus, {
      metadata: meta,
      ...(heartbeatStatus === "ERROR" ? {
        errorCode: success === 0 ? "TOTAL_FAILURE"
          : budgetExhausted ? "BUDGET_EXHAUSTED"
          : "PARTIAL_FAILURES",
        errorMessage: budgetExhausted
          ? `Budget exhausted after ${processed}/${eligible.length} items (${failed} failed)`
          : `${failed} of ${eligible.length} items failed`,
      } : {}),
    });

    console.log(`[${JOB_NAME}] Completed: ${success} ok, ${failed} failed, ${skipped} skipped of ${eligible.length} in ${durationMs}ms`);

    return new Response(
      JSON.stringify({ ok: true, ...meta }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error(`[${JOB_NAME}] Fatal error:`, err);
    await finishHeartbeat(admin, hb, "ERROR", {
      errorCode: "GLOBAL_SYNC_FATAL",
      errorMessage: err?.message || "unknown",
      metadata: { duration_ms: durationMs },
    });
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "unknown", duration_ms: durationMs }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
