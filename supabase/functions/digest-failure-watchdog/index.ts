/**
 * digest-failure-watchdog — AD2(c): the safety net for the morning brief.
 *
 * DEFECT CLASS BEING CLOSED: if `scheduled-daily-digest` fails, the lawyer
 * receives nothing — and silence is indistinguishable from a quiet day. That
 * is the exact confusion this engagement exists to remove.
 *
 * This function does NOT depend on the digest: it runs on its own cron, reads
 * `daily_digest_runs` from the outside, and reports three distinct conditions
 * for the current Bogotá day:
 *   FAILED   — the digest ran and wrote a failure (error_summary carried here).
 *   MISSING  — a recipient with monitored matters has NO run row at all
 *              (the digest crashed before claiming, or never fired).
 *   STUCK    — a run row is still RUNNING long after it should have finished.
 *
 * It writes straight to `email_outbox` and kicks the sender, so the alert path
 * shares nothing with the digest composer beyond the mail transport itself.
 *
 * It NEVER sends judicial content and NEVER touches a lawyer's mailbox: the
 * single recipient is the operations address.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { finishHeartbeat, startHeartbeat } from "../_shared/platformJobHeartbeat.ts";
import { classifyDigestDay, renderWatchdogHtml, renderWatchdogSubject } from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const OPS_EMAIL = "gr@lexetlit.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bogotaDate(now = new Date()): string {
  return new Date(now.getTime() - 5 * 3600_000).toISOString().slice(0, 10);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const digestDate = typeof body?.digest_date === "string" ? body.digest_date : bogotaDate();
  const dryRun = body?.dry_run === true;

  const hb = await startHeartbeat(supabase, "digest-failure-watchdog", String(body?.source ?? "cron"), {
    digest_date: digestDate,
  });

  try {
    // Expected recipients: owners of monitored matters, from the canonical view.
    const { data: monitored, error: monErr } = await supabase
      .from("v_monitored_work_items")
      .select("owner_id");
    if (monErr) throw monErr;
    const expected = new Set<string>(
      (monitored ?? []).map((m) => m.owner_id as string).filter(Boolean),
    );

    const { data: runs, error: runErr } = await supabase
      .from("daily_digest_runs")
      .select("recipient_user_id, status, error_summary, created_at, finished_at, recipient_email")
      .eq("digest_date", digestDate);
    if (runErr) throw runErr;

    const verdict = classifyDigestDay(expected, (runs ?? []) as never[]);
    const { failed, stuck, missing, problems } = verdict;

    const result = {
      digest_date: digestDate,
      expected_recipients: expected.size,
      failed: failed.length,
      stuck: stuck.length,
      missing: missing.length,
      alerted: false,
    };

    if (problems === 0 || dryRun) {
      await finishHeartbeat(supabase, hb, "OK", { metadata: { ...result, dry_run: dryRun } });
      return json({ ok: true, ...result, dry_run: dryRun });
    }

    const html = renderWatchdogHtml(digestDate, expected.size, verdict);

    const { error: outErr } = await supabase.from("email_outbox").insert({
      organization_id: "00000000-0000-0000-0000-000000000000",
      to_email: OPS_EMAIL,
      subject: renderWatchdogSubject(digestDate, verdict),
      html,
      status: "PENDING",
      next_attempt_at: new Date().toISOString(),
      trigger_reason: "DIGEST_FAILURE_ALERT",
      trigger_event: "digest-failure-watchdog",
      dedupe_key: `digest-failure-${digestDate}`,
    });

    // 23505 = the alert for this day was already enqueued; not an error.
    if (outErr && (outErr as { code?: string }).code !== "23505") throw outErr;

    result.alerted = !outErr;
    if (!outErr) {
      await fetch(`${FUNCTIONS_BASE}/process-email-outbox`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "digest-failure-watchdog" }),
      }).catch((e) => console.warn("[digest-failure-watchdog] outbox kick failed", e));
    }

    await finishHeartbeat(supabase, hb, "OK", { metadata: result });
    return json({ ok: true, ...result });
  } catch (err) {
    console.error("[digest-failure-watchdog] fatal", err);
    await finishHeartbeat(supabase, hb, "ERROR", { errorMessage: String(err) });
    return json({ ok: false, error: String(err) }, 500);
  }
});
