/**
 * global-master-sync — Server-side Global Master Sync (super admin override).
 *
 * Runs with service role, writes platform_job_heartbeats start/finish,
 * processes eligible work items within a deadline-aware execution budget.
 *
 * FIX 1: Deadline guard reserves 8s for finishHeartbeat (142s work budget).
 * FIX 2: try/finally ensures finishHeartbeat ALWAYS fires.
 * FIX 3: resolveStatus() is a pure function for status resolution.
 * FIX 4: Release-gate mode respects the same deadline guard.
 * FIX 5: Response includes heartbeat_id, heartbeat_status, heartbeat_written_at.
 *
 * POST { _scheduled?: boolean }
 *
 * Release-gate mode (deterministic failure injection):
 *   POST { release_gate: { force_timeout_provider: "SAMAI_ESTADOS", force_once: true } }
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  startHeartbeat,
  finishHeartbeat,
  type HeartbeatHandle,
} from "../_shared/platformJobHeartbeat.ts";
import {
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
} from "../_shared/syncPolicy.ts";

const JOB_NAME = "global-master-sync";

// ─── FIX 1: Deadline-aware budget ───────────────────────────────────
const HARD_LIMIT_MS = 150_000;
const FINISH_HEARTBEAT_RESERVE_MS = 8_000;
const EXEC_BUDGET_MS = HARD_LIMIT_MS - FINISH_HEARTBEAT_RESERVE_MS; // 142s

const INTER_ITEM_DELAY_MS = 300;
const PER_ITEM_TIMEOUT_MS = 15_000;
const MAX_FAILED_ITEMS_IN_META = 20;

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

// ─── FIX 3: Pure status resolution ──────────────────────────────────

function resolveStatus(
  failed: number,
  budgetExhausted: boolean,
  topLevelError: Error | null,
): { status: "OK" | "ERROR"; errorCode: string | null; errorMessage: string | null } {
  if (topLevelError) {
    return {
      status: "ERROR",
      errorCode: "UNHANDLED_EXCEPTION",
      errorMessage: topLevelError.message || "unknown",
    };
  }
  if (budgetExhausted) {
    return {
      status: "ERROR",
      errorCode: "BUDGET_EXHAUSTED",
      errorMessage: null, // filled by caller with context
    };
  }
  if (failed > 0) {
    return {
      status: "ERROR",
      errorCode: "PARTIAL_FAILURES",
      errorMessage: null,
    };
  }
  return { status: "OK", errorCode: null, errorMessage: null };
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

/** Handle release-gate forced timeout injection (inside per-item try/catch) */
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
  const releaseGateForceOnce = releaseGate?.force_once !== false;
  let releaseGateFired = false;

  if (releaseGate) {
    console.log(`[${JOB_NAME}] [RELEASE_GATE] Active: force_timeout_provider=${releaseGate.force_timeout_provider}, force_once=${releaseGateForceOnce}`);
  }

  // ─── FIX 1 + FIX 2: Deadline + try/finally ──────────────────────
  const startedAt = Date.now();
  const deadline = startedAt + EXEC_BUDGET_MS; // 142s from now

  let hb: HeartbeatHandle | null = null;
  let topLevelError: Error | null = null;

  // Accumulators — declared outside try so finally can read them
  let total = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;
  let budgetExhausted = false;
  const failedItems: FailedItem[] = [];

  // Heartbeat response fields (FIX 5)
  let heartbeatStatus: "OK" | "ERROR" = "OK";
  let heartbeatWrittenAt: string | null = null;

  try {
    hb = await startHeartbeat(admin, JOB_NAME, "manual_ui", {
      trigger: "GlobalMasterSyncButton",
      release_gate: releaseGate ? { provider: releaseGate.force_timeout_provider } : undefined,
    });

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

    total = eligible.length;

    if (eligible.length === 0) {
      // No items — finishHeartbeat handled in finally
      return; // finally will fire
    }

    // FIX 4: Release-gate caps to 5; normal mode processes all
    const maxItems = releaseGate ? 5 : eligible.length;
    const processingSet = eligible.slice(0, maxItems);

    for (let i = 0; i < processingSet.length; i++) {
      // FIX 1: Deadline guard — checks wall clock, not elapsed duration
      if (Date.now() >= deadline) {
        skipped += processingSet.length - i;
        budgetExhausted = true;
        console.log(`[${JOB_NAME}] Deadline reached after ${processed} items at ${Date.now() - startedAt}ms`);
        break;
      }

      const item = processingSet[i];

      // ── Release-gate injection (FIX 4: inside per-item try/catch) ──
      if (releaseGate && (!releaseGateForceOnce || !releaseGateFired)) {
        releaseGateFired = true;
        try {
          await injectReleaseGateTimeout(admin, item, releaseGate.force_timeout_provider);
        } catch (err: any) {
          console.warn(`[${JOB_NAME}] [RELEASE_GATE] Injection write failed:`, err);
        }
        failed++;
        failedItems.push({
          work_item_id: item.id,
          radicado: item.radicado,
          error_code: "RELEASE_GATE_FORCED_TIMEOUT",
        });
        processed++;
        continue;
      }

      const itemT0 = Date.now();

      try {
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

            const actOk = actsRes.status === "fulfilled" && actsRes.value.data?.ok;
            const pubOk = pubsRes.status === "fulfilled" && pubsRes.value.data?.ok;
            const actHttpErr = actsRes.status === "fulfilled" && actsRes.value.error;
            const pubHttpErr = pubsRes.status === "fulfilled" && pubsRes.value.error;

            if (!actOk && !pubOk) {
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

      // Inter-item delay only if there's time left
      if (i < processingSet.length - 1 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, INTER_ITEM_DELAY_MS));
      }
    }

    // Account for items beyond the processing set (normal mode: all processed; release-gate: rest skipped)
    if (!budgetExhausted) {
      skipped += eligible.length - processed;
    }

  } catch (err: any) {
    topLevelError = err;
    console.error(`[${JOB_NAME}] Fatal error:`, err);
  } finally {
    // ─── FIX 2: finishHeartbeat ALWAYS fires ───────────────────────
    const durationMs = Date.now() - startedAt;
    const failedItemsMeta = failedItems.slice(0, MAX_FAILED_ITEMS_IN_META);

    const resolved = resolveStatus(failed, budgetExhausted, topLevelError);
    heartbeatStatus = resolved.status;

    const heartbeatMeta = {
      total,
      success,
      failed,
      skipped,
      duration_ms: durationMs,
      budget_exhausted: budgetExhausted,
      failed_items: failedItemsMeta,
      release_gate_fired: releaseGate ? releaseGateFired : undefined,
      error_code: resolved.errorCode,
    };

    // Build contextual error message
    let heartbeatErrorMessage = resolved.errorMessage;
    if (!heartbeatErrorMessage && resolved.errorCode === "BUDGET_EXHAUSTED") {
      heartbeatErrorMessage = `Budget exhausted after ${processed}/${total} items (${failed} failed)`;
    } else if (!heartbeatErrorMessage && resolved.errorCode === "PARTIAL_FAILURES") {
      heartbeatErrorMessage = `${failed} of ${total} items failed`;
    }

    if (hb) {
      try {
        await finishHeartbeat(admin, hb, heartbeatStatus, {
          errorCode: resolved.errorCode ?? undefined,
          errorMessage: heartbeatErrorMessage ?? undefined,
          metadata: heartbeatMeta,
        });
        heartbeatWrittenAt = new Date().toISOString();
        console.log(`[${JOB_NAME}] Heartbeat finalized: status=${heartbeatStatus}, id=${hb.id}`);
      } catch (hbErr) {
        console.error(`[${JOB_NAME}] CRITICAL: finishHeartbeat failed:`, hbErr);
      }
    }

    console.log(`[${JOB_NAME}] Done: ${success} ok, ${failed} failed, ${skipped} skipped of ${total} in ${durationMs}ms (budget_exhausted=${budgetExhausted})`);
  }

  // ─── FIX 5: Enriched response ──────────────────────────────────────
  const durationMs = Date.now() - startedAt;
  const responseBody = {
    ok: heartbeatStatus === "OK",
    heartbeat_id: hb?.id ?? null,
    heartbeat_status: heartbeatStatus,
    heartbeat_written_at: heartbeatWrittenAt,
    total,
    success,
    failed,
    skipped,
    budget_exhausted: budgetExhausted,
    duration_ms: durationMs,
    ...(topLevelError ? { error: topLevelError.message } : {}),
    ...(failedItems.length > 0 ? { failed_items: failedItems.slice(0, MAX_FAILED_ITEMS_IN_META) } : {}),
  };

  const httpStatus = topLevelError ? 500 : 200;
  return new Response(JSON.stringify(responseBody), {
    status: httpStatus,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
