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

  const today = todayIsoBogota();
  const stats = { evaluated: 0, alerts_created: 0, skipped_dedup: 0, errors: 0 };

  try {
    const { data: deadlines, error } = await supabase
      .from("work_item_deadlines")
      .select("id, work_item_id, owner_id, organization_id, deadline_type, label, deadline_date, calculation_meta")
      .eq("status", "PENDING")
      .lte("deadline_date", new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10));

    if (error) throw error;

    for (const d of deadlines ?? []) {
      stats.evaluated++;
      const bd = bdRemaining(d.deadline_date);
      let bucket: "D-3" | "D-1" | "D-DAY" | "OVERDUE" | null = null;
      let severity: "WARNING" | "CRITICAL" = "WARNING";
      let title = "";

      if (bd < 0) {
        bucket = "OVERDUE";
        severity = "CRITICAL";
        title = `Término VENCIDO hace ${Math.abs(bd)} día(s) hábiles`;
      } else if (bd === 0) {
        bucket = "D-DAY";
        severity = "CRITICAL";
        title = "Término vence HOY";
      } else if (bd === 1) {
        bucket = "D-1";
        severity = "CRITICAL";
        title = "Término vence MAÑANA";
      } else if (bd <= 3) {
        bucket = "D-3";
        severity = "WARNING";
        title = `Término vence en ${bd} día(s) hábiles`;
      } else {
        continue;
      }

      const fingerprint = `deadline_${bucket}_${d.id}_${today}`;
      const { error: insErr } = await supabase.from("alert_instances").insert({
        owner_id: d.owner_id,
        organization_id: d.organization_id,
        entity_id: d.work_item_id,
        entity_type: "WORK_ITEM",
        severity,
        alert_type: "TERMINO_DEADLINE",
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
        stats.alerts_created++;
      }
    }

    return new Response(JSON.stringify({ ok: true, today, ...stats }), {
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