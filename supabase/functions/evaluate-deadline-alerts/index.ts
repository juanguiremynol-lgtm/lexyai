// deno-lint-ignore-file no-explicit-any
/**
 * evaluate-deadline-alerts
 *
 * SOLE producer of TERMINO_POR_VENCER / TERMINO_CRITICO / TERMINO_VENCIDO.
 * Milestones (business days, weekends only): D-8 (WARNING), D-3 / D-1 / D-DAY
 * (CRITICAL), OVERDUE (CRITICAL). One live alert per deadline_id: later runs
 * update that row and append to payload.escalation_history; never a new row.
 * Intended to be invoked daily 06:00 COT by pg_cron.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalizeAlertPrefs } from "../_shared/alertPreferences.ts";
import { attributionPendingNotice, attributionRoute, businessDaysRemaining, bucketFor, MANUAL_REVIEW_ALERT_TYPE, TERM_ALERT_TYPES, type TermAlertStore, upsertTermAlertCore } from "./termAlert.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function todayIsoBogota(): string {
  // COT is UTC-5, no DST
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
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
    alerts_updated: 0,
    alerts_superseded: 0,
    skipped_closed_by_lawyer: 0,
    skipped_dedup: 0,
    errors: 0,
    manual_review_alerts: 0,
    attribution_pending_alerts: 0,
    not_own_party_skipped: 0,
    judge_side_skipped: 0,
    alerts_retired: 0,
    muted_by_preference: 0,
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

  const termStore: TermAlertStore = {
    findByDeadline: async (deadlineId) => {
      const { data } = await supabase
        .from("alert_instances")
        .select("id, alert_type, severity, title, status, payload, created_at")
        .in("alert_type", TERM_ALERT_TYPES)
        .contains("payload", { deadline_id: deadlineId })
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
    insert: async (row) => {
      const { error } = await supabase.from("alert_instances").insert(row);
      return error ? { message: error.message } : null;
    },
    update: async (id, patch) => {
      const { error } = await supabase.from("alert_instances").update(patch).eq("id", id);
      return error ? { message: error.message } : null;
    },
  };
  const upsertTermAlert = async (args: Parameters<typeof upsertTermAlertCore>[1]) => {
    const r = await upsertTermAlertCore(termStore, args);
    stats.alerts_superseded += r.superseded;
    return r.outcome;
  };

  try {

    // NN2 — attribution is read from `v_deadline_attribution`, the ONE place
    // that decides whether a term is the client's, the counterparty's, the
    // court's, or undetermined. The evaluator never re-derives it.
    const VIEW_COLS =
      "deadline_id, work_item_id, owner_id, organization_id, deadline_type, label, trigger_date, deadline_date, calculation_meta, bound_party_role, is_judge_side, attribution";

    // User notification preferences (alert_preferences.preferences). Missing row
    // => current defaults: every supported milestone, overdue on, manual-review INFO on.
    const prefCache = new Map<string, ReturnType<typeof normalizeAlertPrefs>>();
    async function prefsFor(ownerId: string) {
      if (prefCache.has(ownerId)) return prefCache.get(ownerId)!;
      const { data } = await supabase.from("alert_preferences").select("preferences").eq("user_id", ownerId).maybeSingle();
      const p = normalizeAlertPrefs((data as any)?.preferences);
      prefCache.set(ownerId, p);
      return p;
    }

    // Holiday-aware distance from the engine's own SQL calendar.
    const bdRpc = async (a: string, b: string): Promise<number | null> => {
      const { data, error } = await supabase.rpc("business_days_between_sql", { p_a: a, p_b: b });
      if (error) { console.error("[evaluate-deadline-alerts:bd]", error); return null; }
      return typeof data === "number" ? data : Number(data);
    };

    // Pass 0: deadlines the engine could not compute (no confirmed anchor).
    // One-shot alert per deadline (stable fingerprint) — visible, never silent, never noisy.
    let manualQuery: any = supabase
      .from("v_deadline_attribution")
      .select(VIEW_COLS)
      .eq("status", "REQUIERE_REVISION_MANUAL")
      .is("deadline_date", null);
    if (scopedWorkItemId) manualQuery = manualQuery.eq("work_item_id", scopedWorkItemId);
    const { data: manualReviewRaw, error: mrErr } = await manualQuery;

    if (mrErr) throw mrErr;
    const manualReview = ((manualReviewRaw ?? []) as any[]).map((r) => ({ ...r, id: r.deadline_id }));

    for (const d of (manualReview ?? []) as any[]) {
      // Only a term attributed to our client may alert. JUEZ / CONTRAPARTE /
      // DESCONOCIDO are informative and live in their own lists (NN2 c/d).
      if (d.attribution !== "PROPIO") {
        if (d.attribution === "JUEZ") stats.judge_side_skipped++;
        else stats.not_own_party_skipped++;
        continue;
      }
      // A manual-review record is never presented as an active or overdue term:
      // fixed INFO severity, no provisional urgency escalation.
      const alert_type = MANUAL_REVIEW_ALERT_TYPE;
      const severity = "INFO";
      const mrPrefs = await prefsFor(String(d.owner_id));
      const outcome = await upsertTermAlert({
        allowInsert: mrPrefs.manual_review_info,
        retireWhenMuted: true,
        deadlineId: d.id,
        ownerId: d.owner_id,
        organizationId: d.organization_id,
        workItemId: d.work_item_id,
        alertType: alert_type,
        severity,
        title: "Término en revisión manual — clasificación o cómputo pendientes de validación (sin fecha validada)",
        message: d.label,
        payload: {
          deadline_id: d.id,
          deadline_type: d.deadline_type,
          deadline_date: null,
          bucket: "MANUAL_REVIEW",
          trigger_date: d.trigger_date,
          engine: "LOCAL",
          rule: d.calculation_meta ?? null,
        },
      });
      if (outcome === "error") {
        stats.errors++;
      } else if (outcome === "closed_by_lawyer") {
        stats.skipped_closed_by_lawyer++;
      } else if (outcome === "muted_by_preference") {
        stats.muted_by_preference++;
      } else {
        stats.manual_review_alerts++;
        if (outcome === "inserted") stats.alerts_created++;
        else stats.alerts_updated++;
      }


    }

    const notOwnDeadlineIds: string[] = [];

    let pendingQuery: any = supabase
      .from("v_deadline_attribution")
      .select(VIEW_COLS)
      .eq("status", "PENDING")
      .not("deadline_date", "is", null)
      .lte("deadline_date", new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10));
    if (scopedWorkItemId) pendingQuery = pendingQuery.eq("work_item_id", scopedWorkItemId);
    const { data: deadlinesRaw, error } = await pendingQuery;

    if (error) throw error;
    const deadlines = ((deadlinesRaw ?? []) as any[]).map((r) => ({ ...r, id: r.deadline_id }));

    for (const d of (deadlines ?? []) as any[]) {
      // NN2 — one attribution, computed by the database. A term of the
      // counterparty, of the court, or with an undetermined party never alerts:
      // it is tracked and listed apart, never presented as his obligation.
      const route = attributionRoute(d.attribution);
      if (route === "NOT_OWN") {
        if (d.attribution === "JUEZ") stats.judge_side_skipped++;
        else stats.not_own_party_skipped++;
        notOwnDeadlineIds.push(String(d.id));
        continue;
      }
      if (route === "ATTRIBUTION_PENDING") {
        // Dated PENDING record without confirmed own attribution: one stable INFO
        // notice, no urgency bucket, no escalation, never phrased as his duty.
        const n = attributionPendingNotice({ ...d, deadline_date: String(d.deadline_date) });
        const apPrefs = await prefsFor(String(d.owner_id));
        const outcome = await upsertTermAlert({
          allowInsert: apPrefs.manual_review_info,
          retireWhenMuted: true,
          deadlineId: d.id, ownerId: d.owner_id, organizationId: d.organization_id, workItemId: d.work_item_id,
          ...n,
        });
        if (outcome === "error") stats.errors++;
        else if (outcome === "closed_by_lawyer") stats.skipped_closed_by_lawyer++;
        else if (outcome === "muted_by_preference") stats.muted_by_preference++;
        else { stats.attribution_pending_alerts++; if (outcome === "inserted") stats.alerts_created++; else stats.alerts_updated++; }
        continue;
      }
      stats.evaluated++;
      const bd = await businessDaysRemaining(bdRpc, today, String(d.deadline_date));
      if (bd === null) { stats.errors++; continue; }
      const bucket = bucketFor(bd);
      if (!bucket) continue;
      const title = bucket === "OVERDUE" ? `Término VENCIDO hace ${Math.abs(bd)} día(s) hábiles`
        : bucket === "D-DAY" ? "Término vence HOY"
        : bucket === "D-1" ? "Término vence MAÑANA"
        : `Término vence en ${bd} día(s) hábiles`;
      const { alert_type, severity } = classifyTerm(bd);
      const termPrefs = await prefsFor(String(d.owner_id));
      const allowInsert = bucket === "OVERDUE" ? termPrefs.overdue : termPrefs.term_milestones.includes(bucket);

      const outcome = await upsertTermAlert({
        allowInsert,
        deadlineId: d.id,
        ownerId: d.owner_id,
        organizationId: d.organization_id,
        workItemId: d.work_item_id,
        alertType: alert_type,
        severity,
        title,
        message: d.label,
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

      if (outcome === "error") {
        stats.errors++;
      } else if (outcome === "closed_by_lawyer") {
        stats.skipped_closed_by_lawyer++;
      } else if (outcome === "muted_by_preference") {
        stats.muted_by_preference++;
      } else {
        stats.buckets[alert_type]++;
        if (outcome === "inserted") stats.alerts_created++;
        else stats.alerts_updated++;
      }


    }

    // A term that is no longer our client's must stop alerting NOW, not after
    // the alert's own expiry: the confirmation is what made it inapplicable.
    for (const did of notOwnDeadlineIds) {
      const { data: stale } = await supabase
        .from("alert_instances")
        .select("id")
        .eq("status", "PENDING")
        .in("alert_type", TERM_ALERT_TYPES)
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