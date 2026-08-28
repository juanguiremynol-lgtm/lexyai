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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const OPS_EMAIL = "gr@lexetlit.com";
/** A run still RUNNING after this many minutes is considered stuck. */
const STUCK_MINUTES = 30;

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

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

    const byUser = new Map<string, Record<string, unknown>>();
    for (const r of runs ?? []) byUser.set(r.recipient_user_id as string, r);

    const failed: string[] = [];
    const stuck: string[] = [];
    const missing: string[] = [];
    const stuckCutoff = Date.now() - STUCK_MINUTES * 60_000;

    for (const uid of expected) {
      const run = byUser.get(uid);
      if (!run) { missing.push(uid); continue; }
      const status = String(run.status ?? "");
      if (status === "FAILED") {
        failed.push(`${run.recipient_email ?? uid}: ${run.error_summary ?? "sin detalle"}`);
      } else if (
        status === "RUNNING" &&
        Date.parse(String(run.created_at ?? "")) < stuckCutoff
      ) {
        stuck.push(String(run.recipient_email ?? uid));
      }
    }

    const problems = failed.length + stuck.length + missing.length;
    const result = {
      digest_date: digestDate,
      expected_recipients: expected.size,
      failed: failed.length,
      stuck: stuck.length,
      missing: missing.length,
      alerted: false,
    };

    if (problems === 0 || dryRun) {
      await finishHeartbeat(supabase, hb, "OK", { metadata: result });
      return json({ ok: true, ...result });
    }

    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#0f172a;">
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#e2e8f0;">
        <div style="font-size:18px;font-weight:800;color:#f87171;">Andromeda — el resumen diario NO salió completo</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:6px;">
          Día ${esc(digestDate)} (hora de Bogotá). Destinatarios esperados: ${expected.size}.
          Esta alerta la envía un vigilante independiente del resumen: si el resumen se cae, este correo sigue saliendo.
        </div>
        ${failed.length ? `<div style="margin-top:16px;"><b style="color:#f87171;">FALLIDOS (${failed.length})</b>
          <ul style="font-size:13px;line-height:1.6;">${failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        ${missing.length ? `<div style="margin-top:16px;"><b style="color:#fbbf24;">SIN CORRIDA (${missing.length})</b>
          <div style="font-size:13px;color:#94a3b8;">Destinatarios con asuntos monitoreados y ninguna fila en daily_digest_runs: el resumen no llegó a ejecutarse para ellos.</div>
          <ul style="font-size:12px;line-height:1.6;">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
        ${stuck.length ? `<div style="margin-top:16px;"><b style="color:#fbbf24;">ATASCADOS (${stuck.length})</b>
          <ul style="font-size:13px;line-height:1.6;">${stuck.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div>` : ""}
        <div style="margin-top:18px;font-size:12px;color:#94a3b8;">
          Acción: reejecutar <code>scheduled-daily-digest</code> para la fecha indicada. La ventana no se pierde:
          el próximo resumen abre donde cerró el último enviado.
        </div>
      </div></body></html>`;

    const { error: outErr } = await supabase.from("email_outbox").insert({
      organization_id: "00000000-0000-0000-0000-000000000000",
      to_email: OPS_EMAIL,
      subject: `Andromeda — ⚠ resumen diario incompleto (${digestDate}): ${failed.length} fallidos · ${missing.length} sin corrida`,
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
