/**
 * scheduled-alert-evaluator
 * 
 * Cron-driven edge function that evaluates time-based alerts:
 * - AUDIENCIA_PROXIMA: Hearings approaching within configured brackets (72h/24h/1h)
 * - TAREA_VENCIDA: Tasks past their due date (daily re-alert with escalating severity)
 * 
 * Uses service_role key to call insert_notification() directly.
 * Dedupe keys follow build_dedupe_key() contract:
 *   hearing_reminder:{hearing_id}:{bracket}:{yyyy-mm-dd-HH}
 *   task_overdue:{task_id}:{yyyy-mm-dd}
 * 
 * Intended to run every 30 minutes via pg_cron.
 * Idempotent: dedupe keys ensure no duplicates across adjacent runs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTraceContext, writeTraceRecord } from "../_shared/traceContext.ts";
import { buildEmailStats } from "./payloads.ts";
import { evaluateAlerts, newResults, publicResults } from "./evaluate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const runMode = body?.run_mode || "CRON";
  const trace = createTraceContext("scheduled-alert-evaluator", runMode, {
    cron_run_id: body?.cron_run_id,
  });
  const startedAt = new Date();

  const results = newResults();

  // ── P1.2 NO-OP EARLY EXIT ──
  // Two head counts. With no upcoming hearing and no overdue task there is
  // nothing to evaluate: exit before writing any trace record.
  try {
    const [{ count: hearingCount }, { count: taskCount }] = await Promise.all([
      supabase
        .from("work_item_hearings")
        .select("id", { count: "exact", head: true })
        .gt("scheduled_at", new Date().toISOString())
        .lt("scheduled_at", new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString())
        .in("status", ["scheduled", "planned"]),
      supabase
        .from("work_item_tasks")
        .select("id", { count: "exact", head: true })
        .lt("due_date", new Date().toISOString().split("T")[0])
        .neq("status", "COMPLETADA"),
    ]);
    if ((hearingCount ?? 0) === 0 && (taskCount ?? 0) === 0) {
      return new Response(
        JSON.stringify({ ok: true, no_op: true, ...publicResults(results) }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (noopErr) {
    // A failed pre-check must never silence the run: fall through and let the
    // normal path (which logs) execute.
    console.warn("[scheduled-alert-evaluator] no-op pre-check failed:", noopErr);
  }

  try {
    await evaluateAlerts(supabase, results);

    const traceStatus = results.errors.length > 0 ? "PARTIAL" : "OK";
    await writeTraceRecord(supabase, trace, traceStatus, {
      work_items_scanned: results.hearings_evaluated + results.tasks_evaluated,
      email_stats: buildEmailStats({
        evaluated: results.hearings_evaluated + results.tasks_evaluated,
        accepted: results.hearing_alerts_created + results.task_alerts_created,
        failed: results.notification_requests_failed,
      }),
      read_errors: results.read_errors.length,
      notification_rpc_errors: results.notification_requests_failed,
      errors: results.errors.length > 0
        ? [{ code: "ALERT_EVAL_ERR", message: results.errors.slice(0, 5).join("; "), count: results.errors.length }]
        : undefined,
      hearings_evaluated: results.hearings_evaluated,
      hearing_alerts_created: results.hearing_alerts_created,
      tasks_evaluated: results.tasks_evaluated,
      task_alerts_created: results.task_alerts_created,
    }, startedAt);

    return new Response(JSON.stringify({ ok: true, results: publicResults(results), cron_run_id: trace.cron_run_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[scheduled-alert-evaluator] Fatal:", err);
    await writeTraceRecord(supabase, trace, "ERROR", {
      errors: [{ code: "FATAL", message: err instanceof Error ? err.message : "Unknown", count: 1 }],
    }, startedAt);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown", cron_run_id: trace.cron_run_id }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
