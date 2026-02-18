/**
 * scheduled-alert-evaluator
 * 
 * Cron-driven edge function that evaluates time-based alerts:
 * - AUDIENCIA_PROXIMA: Hearings approaching within configured days
 * - TAREA_VENCIDA: Tasks past their due date
 * - TERMINO_CRITICO: Terms/deadlines approaching
 * 
 * Uses the same insert_notification() SQL function as all DB triggers,
 * ensuring a single contract for dedup, preferences, and insertion.
 * 
 * Intended to run every 30 minutes via pg_cron.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const results = {
    hearings_evaluated: 0,
    hearing_alerts_created: 0,
    tasks_evaluated: 0,
    task_alerts_created: 0,
    errors: [] as string[],
  };

  try {
    // ── 1. AUDIENCIA_PROXIMA ──────────────────────────────────
    // Find hearings in the next 72 hours that haven't been alerted yet
    const { data: upcomingHearings, error: hearingErr } = await supabase
      .from("hearings")
      .select("id, owner_id, title, scheduled_at, location, is_virtual, work_item_id")
      .gt("scheduled_at", new Date().toISOString())
      .lt("scheduled_at", new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString())
      .is("deleted_at", null);

    if (hearingErr) {
      results.errors.push(`Hearings query: ${hearingErr.message}`);
    } else if (upcomingHearings) {
      results.hearings_evaluated = upcomingHearings.length;

      for (const h of upcomingHearings) {
        const hoursUntil = Math.round(
          (new Date(h.scheduled_at).getTime() - Date.now()) / (1000 * 60 * 60)
        );
        
        // Determine reminder bracket for dedupe: 72h, 24h, 1h
        let bracket: string;
        if (hoursUntil <= 1) bracket = "1h";
        else if (hoursUntil <= 24) bracket = "24h";
        else bracket = "72h";

        // Get recipients (owner + work_item participants if linked)
        let recipientIds: string[] = [h.owner_id];
        if (h.work_item_id) {
          const { data: recipients } = await supabase.rpc(
            "get_work_item_recipients",
            { p_work_item_id: h.work_item_id }
          );
          if (recipients?.length) {
            recipientIds = [...new Set([...recipientIds, ...recipients.map((r: any) => r.recipient_id)])];
          }
        }

        for (const userId of recipientIds) {
          const { error: rpcErr } = await supabase.rpc("insert_notification", {
            p_audience_scope: "USER",
            p_user_id: userId,
            p_category: "WORK_ITEM_ALERTS",
            p_type: "AUDIENCIA_PROXIMA",
            p_title: `Audiencia próxima: ${h.title}`,
            p_body: `En ${hoursUntil}h — ${h.location || (h.is_virtual ? "Virtual" : "Sin ubicación")}`,
            p_severity: hoursUntil <= 1 ? "critical" : hoursUntil <= 24 ? "warning" : "info",
            p_metadata: JSON.stringify({
              hearing_id: h.id,
              scheduled_at: h.scheduled_at,
              hours_until: hoursUntil,
              bracket,
            }),
            p_dedupe_key: `HEARING_REMINDER_${h.id}_${bracket}_${userId}`,
            p_deep_link: h.work_item_id
              ? `/app/work-items/${h.work_item_id}`
              : "/app/hearings",
            p_work_item_id: h.work_item_id,
          });

          if (rpcErr) {
            results.errors.push(`Hearing ${h.id} user ${userId}: ${rpcErr.message}`);
          } else {
            results.hearing_alerts_created++;
          }
        }
      }
    }

    // ── 2. TAREA_VENCIDA ─────────────────────────────────────
    // Find overdue tasks (past due_date, status not COMPLETADA)
    const { data: overdueTasks, error: taskErr } = await supabase
      .from("work_item_tasks")
      .select("id, owner_id, assigned_to, title, due_date, work_item_id, priority")
      .lt("due_date", new Date().toISOString().split("T")[0])
      .neq("status", "COMPLETADA")
      .is("deleted_at", null);

    if (taskErr) {
      results.errors.push(`Tasks query: ${taskErr.message}`);
    } else if (overdueTasks) {
      results.tasks_evaluated = overdueTasks.length;

      for (const t of overdueTasks) {
        const targetUser = t.assigned_to || t.owner_id;
        const daysPast = Math.floor(
          (Date.now() - new Date(t.due_date).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Dedupe by date so we re-alert daily for overdue tasks
        const today = new Date().toISOString().split("T")[0];

        const { error: rpcErr } = await supabase.rpc("insert_notification", {
          p_audience_scope: "USER",
          p_user_id: targetUser,
          p_category: "WORK_ITEM_ALERTS",
          p_type: "TAREA_VENCIDA",
          p_title: `Tarea vencida: ${t.title}`,
          p_body: `Vencida hace ${daysPast} día(s) — Prioridad: ${t.priority || "MEDIA"}`,
          p_severity: daysPast >= 3 ? "critical" : "warning",
          p_metadata: JSON.stringify({
            task_id: t.id,
            due_date: t.due_date,
            days_past: daysPast,
            priority: t.priority,
          }),
          p_dedupe_key: `TASK_OVERDUE_${t.id}_${today}_${targetUser}`,
          p_deep_link: `/app/work-items/${t.work_item_id}`,
          p_work_item_id: t.work_item_id,
        });

        if (rpcErr) {
          results.errors.push(`Task ${t.id}: ${rpcErr.message}`);
        } else {
          results.task_alerts_created++;
        }

        // Also notify owner if task is assigned to someone else
        if (t.assigned_to && t.assigned_to !== t.owner_id) {
          await supabase.rpc("insert_notification", {
            p_audience_scope: "USER",
            p_user_id: t.owner_id,
            p_category: "WORK_ITEM_ALERTS",
            p_type: "TAREA_VENCIDA",
            p_title: `Tarea vencida: ${t.title}`,
            p_body: `Vencida hace ${daysPast} día(s) — Asignada a otro usuario`,
            p_severity: daysPast >= 3 ? "critical" : "warning",
            p_metadata: JSON.stringify({
              task_id: t.id,
              due_date: t.due_date,
              days_past: daysPast,
              assigned_to: t.assigned_to,
            }),
            p_dedupe_key: `TASK_OVERDUE_${t.id}_${today}_${t.owner_id}`,
            p_deep_link: `/app/work-items/${t.work_item_id}`,
            p_work_item_id: t.work_item_id,
          });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[scheduled-alert-evaluator] Fatal:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
