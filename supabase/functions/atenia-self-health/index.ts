/**
 * atenia-self-health — Meta-monitoring (Capability 8).
 *
 * Runs every 15 min via pg_cron. Checks if Atenia AI itself is healthy:
 * heartbeat alive, daily sync ran, edge functions responsive, DB alive.
 * Fires urgent notification if anything is broken.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { heartbeatNoOp, startHeartbeat, finishHeartbeat } from "../_shared/platformJobHeartbeat.ts";
import {
  aiVerifyLinkProbe,
  makeAiVerifyHealthSink,
  AI_VERIFY_HEALTH_SERVICE,
} from "../_shared/aiVerifyLink.ts";
import { classifySchemaAccess, type SchemaAccessProbe } from "../_shared/schemaAccessGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const checks: HealthCheck[] = [];

  try {
    // Check 0 (ITER53/D1): can we SEE the schema at all? A degraded read must
    // never be reported as a health result — it is not evidence of anything.
    const { data: probeRaw } = await supabase.rpc("schema_access_probe");
    const verdict = classifySchemaAccess(
      (probeRaw ?? null) as unknown as SchemaAccessProbe | null,
    );
    if (verdict.conclusionsForbidden) {
      return new Response(
        JSON.stringify({
          ok: false,
          schema_access: verdict.state,
          detail: verdict.reason,
          checks: [],
          note: "No se emiten conclusiones de salud: la lectura del esquema no es concluyente.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }
    checks.push({ name: "schema_access", ok: true, detail: verdict.reason });

    // Check 1: Last heartbeat (any org) within 8h (P1.1: server-heartbeat now runs every 6h)
    // Check both atenia_ai_actions (heartbeat_observe) AND atenia_cron_runs (HEARTBEAT)
    let heartbeatAge = Infinity;

    const { data: lastHeartbeatAction } = await supabase
      .from("atenia_ai_actions")
      .select("created_at")
      .eq("action_type", "heartbeat_observe")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastHeartbeatAction) {
      heartbeatAge = Date.now() - new Date(lastHeartbeatAction.created_at).getTime();
    }

    // Also check atenia_cron_runs HEARTBEAT as fallback signal
    const { data: lastCronHeartbeat } = await supabase
      .from("atenia_cron_runs")
      .select("finished_at")
      .eq("job_name", "HEARTBEAT")
      .eq("status", "OK")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCronHeartbeat) {
      const cronAge = Date.now() - new Date(lastCronHeartbeat.finished_at).getTime();
      heartbeatAge = Math.min(heartbeatAge, cronAge);
    }

    checks.push({
      name: "HEARTBEAT_ALIVE",
      ok: heartbeatAge < 8 * 60 * 60 * 1000,
      detail:
        heartbeatAge < Infinity
          ? `Último heartbeat: hace ${Math.round(heartbeatAge / 60000)} min`
          : "Sin heartbeat registrado",
    });

    // Check 2: Daily sync ran today (after 8 AM COT / 13:00 UTC)
    const now = new Date();
    const cotHour = (now.getUTCHours() - 5 + 24) % 24;
    const todayStart = new Date(now);
    todayStart.setUTCHours(12, 0, 0, 0); // ~7 AM COT

    if (cotHour >= 8) {
      const { count: todaySyncs } = await supabase
        .from("auto_sync_daily_ledger")
        .select("*", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString());

      checks.push({
        name: "DAILY_SYNC_RAN",
        ok: (todaySyncs ?? 0) > 0,
        detail: `${todaySyncs ?? 0} ejecución(es) de sync diario hoy`,
      });
    } else {
      checks.push({
        name: "DAILY_SYNC_RAN",
        ok: true,
        detail: "Antes de la hora del sync diario — omitido",
      });
    }

    // Check 3: DB connectivity
    const { error: dbErr } = await supabase
      .from("work_items")
      .select("id")
      .limit(1);

    checks.push({
      name: "DB_ALIVE",
      ok: !dbErr,
      detail: dbErr ? `DB error: ${dbErr.message}` : "DB responsive",
    });

    // Check 4: Remediation queue not stuck
    const { count: stuckQueue } = await supabase
      .from("atenia_ai_remediation_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "RUNNING")
      .lt("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    checks.push({
      name: "QUEUE_NOT_STUCK",
      ok: (stuckQueue ?? 0) === 0,
      detail:
        (stuckQueue ?? 0) === 0
          ? "Cola de remediación OK"
          : `${stuckQueue} tarea(s) atascada(s) en cola`,
    });

    // Check 5: Email Alert System Health
    // Verifies: email settings enabled, provider configured, recent outbound emails succeeding
    let emailAlertHealthy = true;
    let emailAlertDetail = "";

    try {
      // 5a: Check system_email_settings
      const { data: emailSettings } = await supabase
        .from("system_email_settings")
        .select("is_enabled, outbound_provider, from_email")
        .maybeSingle();

      if (!emailSettings?.is_enabled) {
        emailAlertHealthy = false;
        emailAlertDetail = "Email system disabled in settings";
      } else if (!emailSettings.outbound_provider) {
        emailAlertHealthy = false;
        emailAlertDetail = "No outbound provider configured";
      } else {
        // 5b: Check recent email delivery success rate (last 6 hours)
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data: recentEmails } = await supabase
          .from("system_email_messages")
          .select("provider_status")
          .eq("direction", "outbound")
          .gte("created_at", sixHoursAgo)
          .limit(50);

        const emails = recentEmails || [];
        if (emails.length === 0) {
          emailAlertDetail = `Provider: ${emailSettings.outbound_provider}, from: ${emailSettings.from_email}. No emails in last 6h (no traffic).`;
        } else {
          const failed = emails.filter((e: any) => e.provider_status === "failed").length;
          const failRate = Math.round((failed / emails.length) * 100);
          if (failRate > 30) {
            emailAlertHealthy = false;
            emailAlertDetail = `Provider: ${emailSettings.outbound_provider}. ${failed}/${emails.length} emails failed (${failRate}%) in last 6h.`;
          } else {
            emailAlertDetail = `Provider: ${emailSettings.outbound_provider}. ${emails.length - failed}/${emails.length} emails OK (${100 - failRate}%) in last 6h.`;
          }
        }

        // 5c: Check notification delivery pipeline — recent notifications created
        const { count: recentNotifs } = await supabase
          .from("notifications")
          .select("*", { count: "exact", head: true })
          .gte("created_at", sixHoursAgo);

        emailAlertDetail += ` | ${recentNotifs ?? 0} notifications created (6h).`;

        // 5d: Check alert_instances pipeline
        const { count: recentAlerts } = await supabase
          .from("alert_instances")
          .select("*", { count: "exact", head: true })
          .gte("fired_at", sixHoursAgo);

        emailAlertDetail += ` | ${recentAlerts ?? 0} alert instances (6h).`;
      }
    } catch (emailErr) {
      emailAlertHealthy = false;
      emailAlertDetail = `Email check error: ${(emailErr as Error).message}`;
    }

    checks.push({
      name: "EMAIL_ALERT_SYSTEM",
      ok: emailAlertHealthy,
      detail: emailAlertDetail,
    });

    // Check 6: ESTADOS_FRESHNESS — the estados/publicaciones pipeline was
    // silently dead for months while the acts chain reported SUCCESS.
    // WARNING when (a) ACTIVE work items with valid 23-digit radicado exist
    // AND zero publicaciones inserted platform-wide in the last 7 days, OR
    // (b) estados-provider error rate exceeds 50% over the last 24h.
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

      const { count: activeWithRadicado } = await supabase
        .from("work_items")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .not("radicado", "is", null);

      const { count: recentPubs } = await supabase
        .from("work_item_publicaciones")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sevenDaysAgo);

      const noInsertsGap =
        (activeWithRadicado ?? 0) > 0 && (recentPubs ?? 0) === 0;

      // Provider error rate proxy: read provider_sync_traces for estados/pub-related stages
      const { data: traces } = await supabase
        .from("provider_sync_traces")
        .select("ok, stage")
        .gte("created_at", oneDayAgo)
        .in("stage", ["publicaciones", "samai_estados", "estados", "ESTADOS", "PUBLICACIONES"]);

      const traceRows = traces || [];
      const failed = traceRows.filter((t: any) => t.ok === false).length;
      const errorRatePct =
        traceRows.length > 0 ? Math.round((failed / traceRows.length) * 100) : 0;
      const highErrorRate = traceRows.length >= 10 && errorRatePct > 50;

      const freshnessOk = !noInsertsGap && !highErrorRate;
      checks.push({
        name: "ESTADOS_FRESHNESS",
        ok: freshnessOk,
        detail: freshnessOk
          ? `Publicaciones OK: ${recentPubs ?? 0} inserts en 7d, error rate 24h=${errorRatePct}% (${traceRows.length} traces)`
          : noInsertsGap
            ? `⚠️ Sin publicaciones nuevas en 7 días con ${activeWithRadicado} asuntos activos con radicado`
            : `⚠️ Tasa de error de proveedor de estados=${errorRatePct}% en 24h (${traceRows.length} intentos)`,
      });

      // Emit one deduped admin notification per day on WARNING
      if (!freshnessOk) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: existing } = await supabase
          .from("admin_notifications")
          .select("id")
          .eq("type", "ESTADOS_FRESHNESS_WARNING")
          .gte("created_at", `${today}T00:00:00Z`)
          .limit(1);

        if (!existing || existing.length === 0) {
          // Emit under a real org — pick any active org
          const { data: anyOrg } = await supabase
            .from("organizations")
            .select("id")
            .limit(1)
            .maybeSingle();
          if (anyOrg?.id) {
            await supabase.from("admin_notifications").insert({
              organization_id: anyOrg.id,
              type: "ESTADOS_FRESHNESS_WARNING",
              title: "Publicaciones/estados sin novedad reciente",
              message: noInsertsGap
                ? `Sin publicaciones nuevas en 7 días con ${activeWithRadicado} asuntos activos con radicado. Verifique el proveedor de publicaciones/estados.`
                : `Tasa de error del proveedor de estados=${errorRatePct}% en 24h.`,
            });
          }
        }
      }
    } catch (freshErr) {
      checks.push({
        name: "ESTADOS_FRESHNESS",
        ok: false,
        detail: `Freshness check error: ${(freshErr as Error).message}`,
      });
    }

    // Check: sonda viva de la verificación por IA (máx. 1 vez por hora).
    try {
      const { data: hb } = await supabase
        .from("system_health_heartbeat")
        .select("last_status, last_ok_at, updated_at")
        .eq("service", AI_VERIFY_HEALTH_SERVICE)
        .maybeSingle();
      const lastAge = hb?.updated_at
        ? Date.now() - new Date(hb.updated_at).getTime()
        : Infinity;
      if (lastAge > 55 * 60 * 1000) {
        const verdict = await aiVerifyLinkProbe(
          Deno.env.get("LOVABLE_API_KEY"),
          makeAiVerifyHealthSink(supabase),
        );
        checks.push({
          name: "AI_VERIFY_LINK",
          ok: !!verdict,
          detail: verdict
            ? `Verificación IA activa (veredicto de sonda: ${verdict.verdict})`
            : "⚠️ Verificación IA degradada: el gateway no devolvió veredicto",
        });
      } else {
        checks.push({
          name: "AI_VERIFY_LINK",
          ok: hb?.last_status !== "ERROR",
          detail: `Último latido de verificación IA: hace ${Math.round(lastAge / 60000)} min (${hb?.last_status ?? "SIN DATO"})`,
        });
      }
    } catch (aiErr) {
      checks.push({
        name: "AI_VERIFY_LINK",
        ok: false,
        detail: `Error en sonda de verificación IA: ${(aiErr as Error).message}`,
      });
    }

    const allHealthy = checks.every((c) => c.ok);

    // If unhealthy, send urgent admin notification
    if (!allHealthy) {
      const failedChecks = checks
        .filter((c) => !c.ok)
        .map((c) => c.detail)
        .join("; ");

      await supabase.from("atenia_ai_actions").insert({
        action_type: "SELF_HEALTH_FAILURE",
        actor: "AI_AUTOPILOT",
        scope: "PLATFORM",
        autonomy_tier: "ACT",
        reasoning: `⚠️ Auto-diagnóstico falló: ${failedChecks}. Requiere intervención.`,
        status: "EXECUTED",
        action_result: "applied",
        evidence: { checks, healthy: false },
      });
    }

    // P1.2: a healthy run is a no-op — no history row, only the single
    // coalesced current-state heartbeat so the watchdog still sees liveness.
    if (allHealthy) {
      await heartbeatNoOp(supabase, "atenia-self-health", { checks: checks.length });
      return new Response(
        JSON.stringify({ ok: true, healthy: true, no_op: true, checks }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Unhealthy → full logging, as before.
    await supabase.from("atenia_ai_actions").insert({
      action_type: "SELF_HEALTH_CHECK",
      actor: "AI_AUTOPILOT",
      scope: "PLATFORM",
      autonomy_tier: "OBSERVE",
      reasoning: allHealthy
        ? `Auto-diagnóstico OK: ${checks.length} verificaciones pasadas.`
        : `Auto-diagnóstico: ${checks.filter((c) => !c.ok).length} fallo(s).`,
      status: "EXECUTED",
      action_result: allHealthy ? "logged" : "applied",
      evidence: { checks, healthy: allHealthy },
    });

    return new Response(
      JSON.stringify({ ok: true, healthy: allHealthy, checks }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    // Failures ALWAYS log, in full.
    try {
      const hb = await startHeartbeat(supabase, "atenia-self-health", "cron");
      await finishHeartbeat(supabase, hb, "ERROR", {
        errorMessage: (err as Error).message?.slice(0, 500),
      });
      await supabase.from("atenia_ai_actions").insert({
        action_type: "SELF_HEALTH_FAILURE",
        actor: "AI_AUTOPILOT",
        scope: "PLATFORM",
        autonomy_tier: "ACT",
        reasoning: `Auto-diagnóstico abortó con error: ${(err as Error).message}`,
        status: "FAILED",
        action_result: "failed",
        evidence: { error: (err as Error).message, checks },
      });
    } catch { /* non-fatal */ }
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
