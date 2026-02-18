/**
 * notify-waitlist-launch
 *
 * Checks if the platform is LIVE. If so, emails every waitlist signup
 * that hasn't been notified yet (or was notified for a different launch date).
 * Enqueues branded HTML into email_outbox for delivery by process-email-outbox.
 *
 * Designed to run on a cron schedule (every 30 min) so it auto-fires
 * once launch goes live, with no manual intervention.
 *
 * If the launch date is pushed back, signups notified for the OLD date
 * will be re-notified with the corrected date.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LAUNCH_AT_ISO = Deno.env.get("VITE_LAUNCH_AT_ISO") || "2026-03-01T05:00:00Z";
const PLATFORM_ORG_ID = "00000000-0000-0000-0000-000000000000";
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Health check
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.health_check) {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Check launch gate ──
    const launchAt = new Date(LAUNCH_AT_ISO);
    const now = new Date();
    const isLive = now >= launchAt;

    if (!isLive) {
      return new Response(
        JSON.stringify({ status: "prelaunch", message: "Not yet live", launchAt: LAUNCH_AT_ISO }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const launchDate = launchAt.toISOString().split("T")[0]; // e.g. "2026-03-01"

    // ── Fetch un-notified (or stale-date) signups ──
    const { data: signups, error: fetchErr } = await admin
      .from("waitlist_signups")
      .select("id, email")
      .or(`notified_at.is.null,launch_date_used.neq.${launchDate}`)
      .limit(BATCH_SIZE);

    if (fetchErr) throw fetchErr;
    if (!signups || signups.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", message: "No pending signups to notify", launchDate }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build branded email HTML ──
    const launchDateStr = launchAt.toLocaleDateString("es-CO", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/Bogota",
    });

    const html = buildLaunchEmailHtml(launchDateStr);

    // ── Enqueue emails into email_outbox ──
    const outboxRows = signups.map((s) => ({
      to_email: s.email,
      subject: "🚀 ¡Andromeda ya está en vivo! Tu acceso Beta gratuito te espera",
      html,
      organization_id: PLATFORM_ORG_ID,
      status: "PENDING",
      next_attempt_at: now.toISOString(),
      trigger_reason: "WAITLIST_LAUNCH_NOTIFICATION",
      dedupe_key: `WAITLIST_LAUNCH_${s.id}_${launchDate}`,
    }));

    const { error: insertErr } = await admin
      .from("email_outbox")
      .upsert(outboxRows, { onConflict: "dedupe_key", ignoreDuplicates: true });

    if (insertErr) throw insertErr;

    // ── Mark signups as notified ──
    const ids = signups.map((s) => s.id);
    const { error: updateErr } = await admin
      .from("waitlist_signups")
      .update({ notified_at: now.toISOString(), launch_date_used: launchDate })
      .in("id", ids);

    if (updateErr) throw updateErr;

    // ── Trigger process-email-outbox ──
    try {
      await fetch(`${supabaseUrl}/functions/v1/process-email-outbox`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ triggered_by: "WAITLIST_LAUNCH_NOTIFICATION" }),
      });
    } catch (_) {
      // Non-fatal; scheduler will pick it up
    }

    return new Response(
      JSON.stringify({ status: "ok", notified: signups.length, launchDate }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("notify-waitlist-launch error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function buildLaunchEmailHtml(launchDateStr: string): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#070b1a;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#070b1a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#0c1529 0%,#070b1a 100%);border:1px solid #1a3a6a40;border-radius:16px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:40px 40px 20px;text-align:center;">
          <img src="https://qvuukbqcvlnvmcvcruji.supabase.co/storage/v1/object/public/email-assets/andromeda-logo.png" alt="Andromeda" width="180" style="max-width:180px;" />
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:20px 40px 40px;">
          <h1 style="color:#d4a017;font-size:28px;text-align:center;margin:0 0 20px;">🚀 ¡Estamos en vivo!</h1>
          <p style="color:#e0e7f0;font-size:16px;line-height:1.6;text-align:center;">
            Te registraste en nuestra lista de espera y hoy queremos contarte:
            <strong style="color:#0ea5e9;">Andromeda Beta ya está disponible.</strong>
          </p>
          <p style="color:#a0b4d0;font-size:15px;line-height:1.6;text-align:center;">
            Gestión judicial inteligente, simplificada por IA. Tu prueba gratuita de
            <strong style="color:#d4a017;">3 meses</strong> te está esperando.
          </p>
          <div style="text-align:center;padding:30px 0;">
            <a href="https://andromeda.legal/auth" style="background:linear-gradient(135deg,#d4a017,#e8b830);color:#070b1a;font-weight:bold;font-size:16px;padding:14px 36px;border-radius:8px;text-decoration:none;display:inline-block;">
              Comenzar gratis — 3 meses
            </a>
          </div>
          <p style="color:#a0b4d0;font-size:13px;text-align:center;">
            Sin tarjeta de crédito · Solo Google Auth · Fecha de lanzamiento: ${launchDateStr}
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid #1a3a6a30;text-align:center;">
          <p style="color:#a0b4d070;font-size:12px;margin:0;">
            Recibiste este email porque te registraste en la lista de espera de Andromeda.<br/>
            © ${new Date().getFullYear()} Andromeda · info@andromeda.legal
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
