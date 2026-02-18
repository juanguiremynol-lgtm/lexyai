/**
 * global-master-sync — Server-side Global Master Sync (super admin override).
 *
 * Runs with service role, writes platform_job_heartbeats start/finish,
 * processes eligible work items within a 120s execution budget.
 * If budget exhausted, finishes with partial results.
 *
 * POST { _scheduled?: boolean }
 * Returns: { ok, total, success, failed, skipped, duration_ms, budget_exhausted }
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

  const t0 = Date.now();
  const hb = await startHeartbeat(admin, JOB_NAME, "manual_ui", {
    trigger: "GlobalMasterSyncButton",
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
      const meta = { total: 0, success: 0, failed: 0, skipped: 0, duration_ms: Date.now() - t0 };
      await finishHeartbeat(admin, hb, "OK", { metadata: meta });
      return new Response(JSON.stringify({ ok: true, ...meta }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let success = 0;
    let failed = 0;
    let processed = 0;
    let budgetExhausted = false;

    for (let i = 0; i < eligible.length; i++) {
      // Budget check before each item
      if (Date.now() - t0 > BUDGET_MS) {
        budgetExhausted = true;
        console.log(`[${JOB_NAME}] Budget exhausted after ${processed} items at ${Date.now() - t0}ms`);
        break;
      }

      const item = eligible[i];

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
            const actOk = actsRes.status === "fulfilled" && actsRes.value.data?.ok;
            const pubOk = pubsRes.status === "fulfilled" && pubsRes.value.data?.ok;
            return actOk || pubOk;
          })(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("ITEM_TIMEOUT")), PER_ITEM_TIMEOUT_MS)
          ),
        ]);

        if (itemResult) success++;
        else failed++;
      } catch {
        failed++;
      }

      processed++;

      if (i < eligible.length - 1 && Date.now() - t0 < BUDGET_MS) {
        await new Promise((r) => setTimeout(r, INTER_ITEM_DELAY_MS));
      }
    }

    const skipped = eligible.length - processed;
    const durationMs = Date.now() - t0;

    const meta = {
      total: eligible.length,
      success,
      failed,
      skipped,
      duration_ms: durationMs,
      budget_exhausted: budgetExhausted,
    };

    // Status semantics: OK = clean run, ERROR = degraded or no progress
    const heartbeatStatus = (success === 0 || (failed > 0 || budgetExhausted)) ? "ERROR" : "OK";
    await finishHeartbeat(admin, hb, heartbeatStatus, {
      metadata: meta,
      ...(heartbeatStatus === "ERROR" ? {
        errorCode: budgetExhausted ? "BUDGET_EXHAUSTED" : "PARTIAL_FAILURES",
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
