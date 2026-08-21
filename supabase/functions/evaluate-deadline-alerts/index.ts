// deno-lint-ignore-file no-explicit-any
/**
 * evaluate-deadline-alerts
 *
 * Scheduled function that emits ladder of alerts for PENDING deadlines in
 * `work_item_deadlines`:
 *   - D-3 (business days): severity WARNING
 *   - D-1: severity CRITICAL
 *   - D-day: severity CRITICAL
 *   - Overdue: severity CRITICAL (daily escalation)
 *
 * Idempotent per (deadline_id, bucket=yyyy-mm-dd) via alert_instances.fingerprint.
 * Intended to be invoked daily 06:00 COT by pg_cron.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function todayIsoBogota(): string {
  // COT is UTC-5, no DST
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

/** Simple business-day distance ignoring holidays (approximation for bucketing) */
function bdRemaining(deadlineIso: string): number {
  const target = new Date(deadlineIso + "T00:00:00");
  const today = new Date(todayIsoBogota() + "T00:00:00");
  if (isNaN(target.getTime())) return 0;
  if (+target === +today) return 0;
  const sign = target < today ? -1 : 1;
  const [start, end] = sign > 0 ? [today, target] : [target, today];
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count * sign;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ITER56 — the onboarding surface confirms a capacity and needs the effect in
  // the same session, so the evaluation can be scoped to one matter.
  let scopedWorkItemId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const v = body?.work_item_id;
      if (typeof v === "string" && v.trim()) scopedWorkItemId = v.trim();
    } catch (_e) { /* no body — full portfolio run */ }
  }

  const today = todayIsoBogota();
  const stats = {
    evaluated: 0,
    alerts_created: 0,
    skipped_dedup: 0,
    errors: 0,
    manual_review_alerts: 0,
    not_own_party_skipped: 0,
    judge_side_skipped: 0,
    alerts_retired: 0,
    buckets: { TERMINO_CRITICO: 0, TERMINO_POR_VENCER: 0, TERMINO_VENCIDO: 0 } as Record<string, number>,
  };

  /**
   * Iteration 52 — the alert doctrine has THREE term types by urgency and the
   * severity is the point of the distinction. There is no generic term alert.
   */
  function classifyTerm(bd: number | null): {
    alert_type: "TERMINO_CRITICO" | "TERMINO_POR_VENCER" | "TERMINO_VENCIDO";
    severity: "WARNING" | "CRITICAL";
  } {
    if (bd === null) return { alert_type: "TERMINO_POR_VENCER", severity: "WARNING" };
    if (bd < 0) return { alert_type: "TERMINO_VENCIDO", severity: "CRITICAL" };
    if (bd <= 3) return { alert_type: "TERMINO_CRITICO", severity: "CRITICAL" };
    return { alert_type: "TERMINO_POR_VENCER", severity: "WARNING" };
  }

  /** Weekend-only forward walk, mirroring bdRemaining's approximation. */
  function addBusinessDays(startIso: string, days: number): string | null {
    const d = new Date(startIso + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
    return d.toISOString().slice(0, 10);
  }

  /**
   * EE1 — ONE live alert per deadline, kept current.
   *
   * Deduplication key: `deadline_TERM_<deadline_id>`. It is stable because the
   * deadline id is immutable for the lifetime of the term (the row is never
   * re-created; only its date/status change), it is independent of the
   * evaluation day, of the urgency bucket and of the alert_type, and it
   * survives an escalation POR_VENCER → CRITICO → VENCIDO. The previous key
   * embedded `bucket` and `today`, which is precisely why one term produced one
   * new alert every morning.
   *
   * On escalation the SAME row is updated (alert_type, severity, title,
   * message, payload) and the previous state is appended to
   * `payload.escalation_history`, so the history is kept without multiplying
   * rows. Any other still-live alert for the same deadline is marked
   * SUPERSEDED — never RESOLVED, never DISMISSED, never deleted.
   */
  const LIVE_STATUSES = ["PENDING", "SENT", "ACKNOWLEDGED"];

  async function upsertTermAlert(args: {
    deadlineId: string;
    ownerId: string;
    organizationId: string | null;
    workItemId: string;
    alertType: string;
    severity: string;
    title: string;
    message: string | null;
    payload: Record<string, unknown>;
  }): Promise<"inserted" | "updated" | "error"> {
    const fingerprint = `deadline_TERM_${args.deadlineId}`;

    const { data: live } = await supabase
      .from("alert_instances")
      .select("id, alert_type, severity, title, status, payload, created_at")
      .in("status", LIVE_STATUSES)
      .in("alert_type", ["TERMINO_CRITICO", "TERMINO_POR_VENCER", "TERMINO_VENCIDO"])
      .contains("payload", { deadline_id: args.deadlineId })
      .order("created_at", { ascending: true });

    const rows = (live ?? []) as any[];
    if (rows.length === 0) {
      const { error: insErr } = await supabase.from("alert_instances").insert({
        owner_id: args.ownerId,
        organization_id: args.organizationId,
        entity_id: args.workItemId,
        entity_type: "WORK_ITEM",
        severity: args.severity,
        alert_type: args.alertType,
        title: args.title,
        message: args.message,
        status: "PENDING",
        fingerprint,
        payload: { ...args.payload, escalation_history: [] },
      });
      if (insErr) {
        if ((insErr.message || "").includes("duplicate")) return "updated";
        console.error("[evaluate-deadline-alerts:insert]", insErr);
        return "error";
      }
      return "inserted";
    }

    // The earliest live alert is the one the lawyer has been looking at.
    const keep = rows[0];
    const history = Array.isArray(keep.payload?.escalation_history)
      ? keep.payload.escalation_history
      : [];
    const changed = keep.alert_type !== args.alertType || keep.severity !== args.severity;
    const nextHistory = changed
      ? [
          ...history,
          {
            at: new Date().toISOString(),
            from_alert_type: keep.alert_type,
            from_severity: keep.severity,
            to_alert_type: args.alertType,
            to_severity: args.severity,
          },
        ]
      : history;

    const { error: upErr } = await supabase
      .from("alert_instances")
      .update({
        alert_type: args.alertType,
        severity: args.severity,
        title: args.title,
        message: args.message,
        fingerprint,
        payload: { ...args.payload, escalation_history: nextHistory },
      })
      .eq("id", keep.id);
    if (upErr) {
      console.error("[evaluate-deadline-alerts:update]", upErr);
      return "error";
    }

    // Collapse any older duplicates for the same deadline.
    for (const extra of rows.slice(1)) {
      await supabase.from("alert_instances").update({ status: "SUPERSEDED" }).eq("id", extra.id);
      stats.alerts_superseded++;
    }
    return "updated";
  }

  try {

    // Pass 0: deadlines the engine could not compute (no confirmed anchor).
    // One-shot alert per deadline (stable fingerprint) — visible, never silent, never noisy.
    let manualQuery: any = supabase
      .from("work_item_deadlines")
      .select(
        "id, work_item_id, owner_id, organization_id, deadline_type, label, trigger_date, calculation_meta, bound_party_role, is_judge_side, work_items!inner(workflow_type)",
      )
      .eq("status", "REQUIERE_REVISION_MANUAL")
      .is("deadline_date", null);
    if (scopedWorkItemId) manualQuery = manualQuery.eq("work_item_id", scopedWorkItemId);
    const { data: manualReview, error: mrErr } = await manualQuery;

    if (mrErr) throw mrErr;

    // Rule catalogue: gives the provisional length of a term whose anchor could
    // not be confirmed, so urgency is estimated rather than flattened.
    const { data: ruleRows } = await supabase
      .from("deadline_rules")
      .select("workflow_type, deadline_type, days_amount, day_type, is_active")
      .eq("is_active", true);
    const ruleDays = new Map<string, number>();
    for (const r of (ruleRows ?? []) as any[]) {
      if (r.day_type === "BUSINESS" && Number(r.days_amount) > 0) {
        ruleDays.set(`${r.workflow_type}|${r.deadline_type}`, Number(r.days_amount));
      }
    }

    for (const d of (manualReview ?? []) as any[]) {
      // A term borne by the court is informative and never alerts (iter 50 C3).
      if (d.is_judge_side === true || String(d.bound_party_role ?? "").toUpperCase() === "JUEZ") {
        stats.judge_side_skipped++;
        continue;
      }
      const wfm = Array.isArray(d.work_items) ? d.work_items[0] : d.work_items;
      const wf = String(wfm?.workflow_type ?? "");
      const days =
        ruleDays.get(`${wf}|${d.deadline_type}`) ?? ruleDays.get(`GENERIC|${d.deadline_type}`) ?? null;
      const provisionalDate =
        days && d.trigger_date ? addBusinessDays(String(d.trigger_date), days) : null;
      const bd = provisionalDate ? bdRemaining(provisionalDate) : null;
      const { alert_type, severity } = classifyTerm(bd);
      const { error: insErr } = await supabase.from("alert_instances").insert({
        owner_id: d.owner_id,
        organization_id: d.organization_id,
        entity_id: d.work_item_id,
        entity_type: "WORK_ITEM",
        severity,
        alert_type,
        title: "Término requiere verificación manual — sin fecha de fijación confirmada",
        message: d.label,
        status: "PENDING",
        fingerprint: `deadline_MANUAL_REVIEW_${d.id}`,
        payload: {
          deadline_id: d.id,
          deadline_type: d.deadline_type,
          deadline_date: null,
          provisional_deadline_date: provisionalDate,
          provisional: true,
          business_days_remaining: bd,
          bucket: "MANUAL_REVIEW",
          trigger_date: d.trigger_date,
          engine: "LOCAL",
          rule: d.calculation_meta ?? null,
        },
      });
      if (insErr) {
        if ((insErr.message || "").includes("duplicate")) stats.skipped_dedup++;
        else { stats.errors++; console.error("[evaluate-deadline-alerts:manual]", insErr); }
      } else {
        stats.buckets[alert_type]++;
        stats.manual_review_alerts++;
        stats.alerts_created++;
      }
    }

    const notOwnDeadlineIds: string[] = [];

    let pendingQuery: any = supabase
      .from("work_item_deadlines")
      .select(
        "id, work_item_id, owner_id, organization_id, deadline_type, label, deadline_date, calculation_meta, bound_party_role, is_judge_side, work_items!inner(client_party_role, client_party_represents)",
      )
      .eq("status", "PENDING")
      .not("deadline_date", "is", null)
      .lte("deadline_date", new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10));
    if (scopedWorkItemId) pendingQuery = pendingQuery.eq("work_item_id", scopedWorkItemId);
    const { data: deadlines, error } = await pendingQuery;

    if (error) throw error;

    for (const d of (deadlines ?? []) as any[]) {
      // ITER50/51 — a term bound to the counterparty or to the court is
      // informative for the litigator; it must never alert our client. A term
      // with no resolvable bound party is unattributed and must not alert
      // either: it is surfaced in the UI for the user to attribute.
      const bound = String(
        d.bound_party_role ??
          (d.calculation_meta as Record<string, unknown> | null)?.bound_party_role ??
          "DESCONOCIDO",
      ).toUpperCase();
      const attribution = String(
        (d.calculation_meta as Record<string, unknown> | null)?.attribution ?? "",
      ).toUpperCase();
      const wi = Array.isArray(d.work_items) ? d.work_items[0] : d.work_items;
      const clientRole = String(wi?.client_party_role ?? "").toUpperCase();
      const represents = String(wi?.client_party_represents ?? "").toUpperCase();
      const clientSide =
        clientRole === "DEMANDANTE" || clientRole === "ACCIONANTE"
          ? "ACTIVA"
          : clientRole === "DEMANDADO" || clientRole === "ACCIONADO"
            ? "PASIVA"
            : clientRole === "APODERADO_DE_OFICIO" && represents
              ? represents === "DEMANDANTE" ? "ACTIVA" : "PASIVA"
              : null;
      const own =
        bound === "AMBAS" ||
        (bound === "DEMANDANTE" && clientSide === "ACTIVA") ||
        (bound === "DEMANDADO" && clientSide === "PASIVA");
      const notOwn =
        attribution === "CONTRAPARTE" ||
        attribution === "JUEZ" ||
        bound === "JUEZ" ||
        d.is_judge_side === true ||
        !own;
      if (notOwn) {
        stats.not_own_party_skipped = (stats.not_own_party_skipped ?? 0) + 1;
        notOwnDeadlineIds.push(String(d.id));
        continue;
      }
      stats.evaluated++;
      const bd = bdRemaining(d.deadline_date);
      let bucket: "D-3" | "D-1" | "D-DAY" | "D-8" | "OVERDUE" | null = null;
      let title = "";

      if (bd < 0) {
        bucket = "OVERDUE";
        title = `Término VENCIDO hace ${Math.abs(bd)} día(s) hábiles`;
      } else if (bd === 0) {
        bucket = "D-DAY";
        title = "Término vence HOY";
      } else if (bd === 1) {
        bucket = "D-1";
        title = "Término vence MAÑANA";
      } else if (bd <= 3) {
        bucket = "D-3";
        title = `Término vence en ${bd} día(s) hábiles`;
      } else if (bd <= 8) {
        bucket = "D-8";
        title = `Término vence en ${bd} día(s) hábiles`;
      } else {
        continue;
      }
      const { alert_type, severity } = classifyTerm(bd);

      const fingerprint = `deadline_${bucket}_${d.id}_${today}`;
      const { error: insErr } = await supabase.from("alert_instances").insert({
        owner_id: d.owner_id,
        organization_id: d.organization_id,
        entity_id: d.work_item_id,
        entity_type: "WORK_ITEM",
        severity,
        alert_type,
        title,
        message: d.label,
        status: "PENDING",
        fingerprint,
        payload: {
          deadline_id: d.id,
          deadline_type: d.deadline_type,
          deadline_date: d.deadline_date,
          bucket,
          business_days_remaining: bd,
          engine: "LOCAL",
          rule: d.calculation_meta ?? null,
        },
      });

      if (insErr) {
        if ((insErr.message || "").includes("duplicate")) stats.skipped_dedup++;
        else { stats.errors++; console.error("[evaluate-deadline-alerts]", insErr); }
      } else {
        stats.buckets[alert_type]++;
        stats.alerts_created++;
      }
    }

    // A term that is no longer our client's must stop alerting NOW, not after
    // the alert's own expiry: the confirmation is what made it inapplicable.
    for (const did of notOwnDeadlineIds) {
      const { data: stale } = await supabase
        .from("alert_instances")
        .select("id")
        .eq("status", "PENDING")
        .in("alert_type", ["TERMINO_CRITICO", "TERMINO_POR_VENCER", "TERMINO_VENCIDO"])
        .contains("payload", { deadline_id: did });
      for (const a of (stale ?? []) as any[]) {
        const { error: upErr } = await supabase
          .from("alert_instances")
          .update({ status: "CANCELLED" })
          .eq("id", a.id);
        if (upErr) stats.errors++;
        else stats.alerts_retired++;
      }
    }

    return new Response(JSON.stringify({ ok: true, today, scoped_work_item_id: scopedWorkItemId, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[evaluate-deadline-alerts] fatal", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e), ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});