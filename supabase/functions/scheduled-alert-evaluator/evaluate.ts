/**
 * Core of scheduled-alert-evaluator, isolated so it can be exercised with a
 * mocked client (no real insert_notification, no emails).
 *
 * Error categories are separate:
 *  - read_errors: failed hearing/task queries (no RPC attempted)
 *  - notification_rpc_errors: insert_notification calls that returned an error
 * `errors` remains the combined list for backward compatibility.
 * *_alerts_created / notification_requests_accepted count ACCEPTED RPC calls,
 * not proven inserts: insert_notification returns void and may skip a row by
 * preferences or dedupe.
 */
import { hearingNotificationArgs, taskNotificationArgs, taskOwnerNotificationArgs } from "./payloads.ts";

export function newResults() {
  return {
    hearings_evaluated: 0,
    hearing_alerts_created: 0,
    tasks_evaluated: 0,
    task_alerts_created: 0,
    notification_requests_accepted: 0,
    notification_requests_failed: 0,
    read_errors: [] as string[],
    notification_rpc_errors: [] as string[],
    errors: [] as string[],
  };
}
export type EvalResults = ReturnType<typeof newResults>;

export function publicResults(r: EvalResults) {
  return { ...r, alerts_created_semantics: "accepted_requests_not_proven_inserts" };
}

function pushRead(r: EvalResults, msg: string) { r.read_errors.push(msg); r.errors.push(msg); }
function pushRpc(r: EvalResults, msg: string) {
  r.notification_rpc_errors.push(msg); r.errors.push(msg); r.notification_requests_failed++;
}
function accepted(r: EvalResults, kind: "hearing" | "task") {
  r.notification_requests_accepted++;
  if (kind === "hearing") r.hearing_alerts_created++; else r.task_alerts_created++;
}

// deno-lint-ignore no-explicit-any
export async function evaluateAlerts(supabase: any, results: EvalResults): Promise<EvalResults> {
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
    pushRead(results, `Hearings query: ${hearingErr.message}`);
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
            pushRpc(results, `Hearing ${h.id} bracket ${bracket} user ${userId}: ${rpcErr.message}`);
          } else {
            accepted(results, "hearing");
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
    pushRead(results, `Tasks query: ${taskErr.message}`);
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
        pushRpc(results, `Task ${t.id}: ${rpcErr.message}`);
      } else {
        accepted(results, "task");
      }

      // Also notify owner if assigned to someone else
      if (t.assigned_to && t.assigned_to !== t.owner_id) {
        const { error: ownerErr } = await supabase.rpc(
          "insert_notification",
          taskOwnerNotificationArgs(t, daysPast, today),
        );
        if (ownerErr) {
          pushRpc(results, `Task ${t.id} owner: ${ownerErr.message}`);
        } else {
          accepted(results, "task");
        }
      }
    }
  }

  return results;
}
