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
import {
  buildEmailStats,
  hearingNotificationArgs,
  taskNotificationArgs,
  taskOwnerNotificationArgs,
} from "./payloads.ts";

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

  const results = {
    hearings_evaluated: 0,
    // *_alerts_created keep their legacy names for consumers but count
    // insert_notification requests ACCEPTED (void RPC; may skip by prefs/dedupe).
    hearing_alerts_created: 0,
    tasks_evaluated: 0,
    task_alerts_created: 0,
    errors: [] as string[],
  };

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
        JSON.stringify({ ok: true, no_op: true, ...results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (noopErr) {
    // A failed pre-check must never silence the run: fall through and let the
    // normal path (which logs) execute.
    console.warn("[scheduled-alert-evaluator] no-op pre-check failed:", noopErr);
  }

  try {
    // ── 1. AUDIENCIA_PROXIMA ──────────────────────────────────
    // Find hearings in the next 72 hours (CANONICAL work_item_hearings)
    const { data: rawHearings, error: hearingErr } = await supabase
      .from("work_item_hearings")
      .select("id, created_by, custom_name, scheduled_at, location, modality, work_item_id, hearing_types(name)")
      .gt("scheduled_at", new Date().toISOString())
      .lt("scheduled_at", new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString())
      .in("status", ["scheduled", "planned"]);
    const upcomingHearings = (rawHearings || []).map((h: any) => ({
      id: h.id,
      owner_id: h.created_by,
      title: h.custom_name || h.hearing_types?.name || "Audiencia",
      scheduled_at: h.scheduled_at,
      location: h.location,
      is_virtual: h.modality === "virtual" || h.modality === "mixta",
      work_item_id: h.work_item_id,
    }));

    if (hearingErr) {
      results.errors.push(`Hearings query: ${hearingErr.message}`);
    } else if (upcomingHearings) {
      results.hearings_evaluated = upcomingHearings.length;

      for (const h of upcomingHearings) {
        const hoursUntil = Math.round(
          (new Date(h.scheduled_at).getTime() - Date.now()) / (1000 * 60 * 60)
        );
        
        // Compute ALL relevant brackets not yet fired (handles late inserts)
        // e.g., hearing created 20h before → fire both 24h and (later) 1h brackets
        const brackets: string[] = [];
        if (hoursUntil <= 72 && hoursUntil > 24) brackets.push("72h");
        if (hoursUntil <= 24 && hoursUntil > 1) brackets.push("24h");
        if (hoursUntil <= 1) brackets.push("1h");

        // Get recipients
        let recipientIds: string[] = [h.owner_id];
        if (h.work_item_id) {
          // Use _with_admins since hearing reminders are admin-relevant
          const { data: recipients } = await supabase.rpc(
            "get_work_item_recipients_with_admins",
            { p_work_item_id: h.work_item_id }
          );
          if (recipients?.length) {
            recipientIds = [...new Set([...recipientIds, ...recipients.map((r: any) => r.recipient_id)])];
          }
        }

        for (const bracket of brackets) {
          const now = new Date();
          const hourBucket = `${now.toISOString().slice(0, 10)}-${String(now.getUTCHours()).padStart(2, "0")}`;

          for (const userId of recipientIds) {
            const { error: rpcErr } = await supabase.rpc(
              "insert_notification",
              hearingNotificationArgs(h, userId, bracket, hoursUntil, hourBucket),
            );

            if (rpcErr) {
              results.errors.push(`Hearing ${h.id} bracket ${bracket} user ${userId}: ${rpcErr.message}`);
            } else {
              results.hearing_alerts_created++;
            }
          }
        }
      }
    }

    // ── 2. TAREA_VENCIDA ─────────────────────────────────────
    const { data: overdueTasks, error: taskErr } = await supabase
      .from("work_item_tasks")
      .select("id, owner_id, assigned_to, title, due_date, work_item_id, priority")
      .lt("due_date", new Date().toISOString().split("T")[0])
      .neq("status", "COMPLETADA");

    if (taskErr) {
      results.errors.push(`Tasks query: ${taskErr.message}`);
    } else if (overdueTasks) {
      results.tasks_evaluated = overdueTasks.length;

      for (const t of overdueTasks) {
                const daysPast = Math.floor(
          (Date.now() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24)
        );
        const today = new Date().toISOString().split("T")[0];

        const { error: rpcErr } = await supabase.rpc(
          "insert_notification",
          taskNotificationArgs(t, daysPast, today),
        );

        if (rpcErr) {
          results.errors.push(`Task ${t.id}: ${rpcErr.message}`);
        } else {
          results.task_alerts_created++;
        }

        // Also notify owner if assigned to someone else
        if (t.assigned_to && t.assigned_to !== t.owner_id) {
          const { error: ownerErr } = await supabase.rpc(
            "insert_notification",
            taskOwnerNotificationArgs(t, daysPast, today),
          );
          if (ownerErr) {
            results.errors.push(`Task ${t.id} owner: ${ownerErr.message}`);
          } else {
            results.task_alerts_created++;
          }
        }
      }
    }

    const traceStatus = results.errors.length > 0 ? "PARTIAL" : "OK";
    await writeTraceRecord(supabase, trace, traceStatus, {
      work_items_scanned: results.hearings_evaluated + results.tasks_evaluated,
      email_stats: buildEmailStats({
        evaluated: results.hearings_evaluated + results.tasks_evaluated,
        accepted: results.hearing_alerts_created + results.task_alerts_created,
        failed: results.errors.length,
      }),
      errors: results.errors.length > 0
        ? [{ code: "ALERT_EVAL_ERR", message: results.errors.slice(0, 5).join("; "), count: results.errors.length }]
        : undefined,
      hearings_evaluated: results.hearings_evaluated,
      hearing_alerts_created: results.hearing_alerts_created,
      tasks_evaluated: results.tasks_evaluated,
      task_alerts_created: results.task_alerts_created,
    }, startedAt);

    return new Response(JSON.stringify({ ok: true, results, cron_run_id: trace.cron_run_id }), {
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
