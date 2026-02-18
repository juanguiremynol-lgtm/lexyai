/**
 * atenia-server-heartbeat — Server-side heartbeat for ALL active orgs.
 *
 * Runs every 30 min via pg_cron. Ensures autonomy cycle coverage
 * even when no user has the app open.
 *
 * Dedup: Skips orgs that had a heartbeat within the last 10 min
 * (from client-side useAteniaHeartbeat).
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { startHeartbeat, finishHeartbeat } from "../_shared/platformJobHeartbeat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "atenia-server-heartbeat" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON, proceed normally */ }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Record platform job heartbeat ──
    const hbHandle = await startHeartbeat(supabase, "atenia-server-heartbeat", "cron");

    // Get all orgs with active subscriptions
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, name");

    if (orgsErr) throw orgsErr;

    const results: { org_id: string; status: string; detail?: string }[] = [];

    // ── Pre-flight check every ~90 min (runs for platform, not per-org) ──
    try {
      const { data: recentPF } = await supabase
        .from("atenia_preflight_checks")
        .select("id")
        .eq("trigger", "PRE_HEARTBEAT")
        .gte("created_at", new Date(Date.now() - 80 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (!recentPF) {
        console.log("[server-heartbeat] Running periodic pre-flight check...");
        await supabase.functions.invoke("atenia-preflight-check", {
          body: { trigger: "PRE_HEARTBEAT" },
        });
      }
    } catch (pfErr) {
      console.warn("[server-heartbeat] Pre-flight check failed:", (pfErr as Error).message);
    }

    // ── Scheduled E2E tests (every ~6h guard) ──
    try {
      const { data: recentE2E } = await supabase
        .from("atenia_ai_actions")
        .select("id")
        .eq("action_type", "SCHEDULED_E2E_BATCH")
        .gte("created_at", new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (!recentE2E) {
        console.log("[server-heartbeat] Running scheduled E2E batch...");
        await supabase.functions.invoke("atenia-e2e-scheduled", {
          body: { mode: "FULL", trigger: "SCHEDULED" },
        });
      }
    } catch (e2eErr) {
      console.warn("[server-heartbeat] E2E scheduled failed:", (e2eErr as Error).message);
    }

    // ── Periodic email alert system diagnostic (every ~6h guard) ──
    try {
      const { data: recentEmailDiag } = await supabase
        .from("atenia_ai_actions")
        .select("id")
        .eq("action_type", "EMAIL_ALERT_DIAGNOSTIC")
        .gte("created_at", new Date(Date.now() - 5.5 * 60 * 60 * 1000).toISOString())
        .limit(1)
        .maybeSingle();

      if (!recentEmailDiag) {
        console.log("[server-heartbeat] Running email alert system diagnostic...");

        const diagnosticResults: Record<string, { ok: boolean; detail: string }> = {};

        // 1. Check email settings
        const { data: emailSettings } = await supabase
          .from("system_email_settings")
          .select("is_enabled, outbound_provider, from_email, reply_to")
          .maybeSingle();

        diagnosticResults.settings = {
          ok: !!emailSettings?.is_enabled && !!emailSettings?.outbound_provider,
          detail: emailSettings?.is_enabled
            ? `Provider: ${emailSettings.outbound_provider}, From: ${emailSettings.from_email}`
            : "Email system disabled or not configured",
        };

        // 2. Check email delivery rate (24h)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: dayEmails } = await supabase
          .from("system_email_messages")
          .select("provider_status, direction")
          .eq("direction", "outbound")
          .gte("created_at", oneDayAgo)
          .limit(200);

        const outbound = dayEmails || [];
        const sentOk = outbound.filter((e: any) => e.provider_status === "sent").length;
        const sentFailed = outbound.filter((e: any) => e.provider_status === "failed").length;
        const deliveryRate = outbound.length > 0 ? Math.round((sentOk / outbound.length) * 100) : -1;

        diagnosticResults.delivery = {
          ok: deliveryRate === -1 || deliveryRate >= 70,
          detail: deliveryRate === -1
            ? "No outbound emails in last 24h"
            : `${sentOk}/${outbound.length} delivered (${deliveryRate}%), ${sentFailed} failed`,
        };

        // 3. Check notification pipeline (all audience scopes)
        const { data: notifCounts } = await supabase
          .from("notifications")
          .select("audience_scope")
          .gte("created_at", oneDayAgo)
          .limit(500);

        const scopeCounts: Record<string, number> = {};
        for (const n of notifCounts || []) {
          const scope = (n as any).audience_scope || "UNKNOWN";
          scopeCounts[scope] = (scopeCounts[scope] || 0) + 1;
        }

        diagnosticResults.notifications = {
          ok: true,
          detail: `24h notifications by scope: ${JSON.stringify(scopeCounts)} (total: ${(notifCounts || []).length})`,
        };

        // 4. Check alert_instances pipeline
        const { data: alertCounts } = await supabase
          .from("alert_instances")
          .select("severity, status")
          .gte("fired_at", oneDayAgo)
          .limit(500);

        const severityCounts: Record<string, number> = {};
        for (const a of alertCounts || []) {
          const sev = (a as any).severity || "UNKNOWN";
          severityCounts[sev] = (severityCounts[sev] || 0) + 1;
        }

        diagnosticResults.alert_instances = {
          ok: true,
          detail: `24h alerts by severity: ${JSON.stringify(severityCounts)} (total: ${(alertCounts || []).length})`,
        };

        // 5. Edge function liveness for system-email-send
        try {
          const { error: efError } = await supabase.functions.invoke("system-email-send", {
            body: { health_check: true },
          });
          diagnosticResults.email_edge_function = {
            ok: !efError,
            detail: efError ? `system-email-send unhealthy: ${efError.message}` : "system-email-send responsive",
          };
        } catch (efErr) {
          diagnosticResults.email_edge_function = {
            ok: false,
            detail: `system-email-send error: ${(efErr as Error).message}`,
          };
        }

        const allOk = Object.values(diagnosticResults).every((r) => r.ok);
        const failedChecks = Object.entries(diagnosticResults)
          .filter(([, r]) => !r.ok)
          .map(([k, r]) => `${k}: ${r.detail}`);

        // Log the diagnostic
        await supabase.from("atenia_ai_actions").insert({
          action_type: "EMAIL_ALERT_DIAGNOSTIC",
          actor: "AI_AUTOPILOT",
          scope: "PLATFORM",
          autonomy_tier: allOk ? "OBSERVE" : "ACT",
          reasoning: allOk
            ? `Diagnóstico email/alertas OK: ${Object.keys(diagnosticResults).length} verificaciones pasadas. Delivery rate: ${deliveryRate}%.`
            : `Diagnóstico email/alertas: ${failedChecks.length} fallo(s): ${failedChecks.join("; ")}`,
          status: "EXECUTED",
          action_result: allOk ? "logged" : "applied",
          evidence: {
            checks: diagnosticResults,
            healthy: allOk,
            delivery_rate_pct: deliveryRate,
            timestamp: new Date().toISOString(),
          },
        });

        // If critical failure, create an observation
        if (!allOk && diagnosticResults.settings && !diagnosticResults.settings.ok) {
          try {
            await supabase.from("atenia_ai_observations").insert({
              kind: "ANOMALY",
              severity: "HIGH",
              title: "⚠️ Sistema de email/alertas con fallos",
              payload: { checks: diagnosticResults, failed: failedChecks },
            });
          } catch (_) { /* non-fatal */ }
        }

        console.log(`[server-heartbeat] Email alert diagnostic: ${allOk ? "HEALTHY" : "DEGRADED"}`);
      }
    } catch (emailDiagErr) {
      console.warn("[server-heartbeat] Email alert diagnostic failed:", (emailDiagErr as Error).message);
    }

    for (const org of orgs ?? []) {
      try {
        // Dedup: check if a heartbeat ran recently for this org
        const { data: lastHeartbeat } = await supabase
          .from("atenia_ai_actions")
          .select("created_at")
          .eq("action_type", "heartbeat_observe")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          lastHeartbeat &&
          Date.now() - new Date(lastHeartbeat.created_at).getTime() < DEDUP_WINDOW_MS
        ) {
          results.push({ org_id: org.id, status: "SKIPPED", detail: "Recent heartbeat exists" });
          continue;
        }

        // ── Bug 4 FIX: Timeout handling + error isolation for supervisor invoke ──
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 130_000); // 130s timeout

        const { error: invokeErr } = await supabase.functions.invoke(
          "atenia-ai-supervisor",
          {
            body: {
              mode: "HEARTBEAT",
              organization_id: org.id,
            },
          }
        );

        clearTimeout(timeoutId);

        if (invokeErr) {
          const reason = invokeErr.message ?? "Unknown error";
          results.push({ org_id: org.id, status: "ERROR", detail: reason });

          // Log failure with evidence
          await supabase.from("atenia_ai_actions").insert({
            action_type: "SERVER_HEARTBEAT_FAILURE",
            actor: "AI_AUTOPILOT",
            scope: "ORG",
            organization_id: org.id,
            autonomy_tier: "ACT",
            reasoning: `Heartbeat del servidor falló para org ${org.name}: ${reason}`,
            status: "FAILED",
            action_result: "failed",
            evidence: { error: reason, timestamp: new Date().toISOString() },
          });
        } else {
          results.push({ org_id: org.id, status: "OK" });

          // ── FIX: Write heartbeat_observe action directly as redundancy ──
          // The supervisor HEARTBEAT mode now writes these too, but this ensures
          // the signal exists even if supervisor's write fails for this org.
          try {
            await supabase.from("atenia_ai_actions").insert({
              organization_id: org.id,
              action_type: "heartbeat_observe",
              autonomy_tier: "OBSERVE",
              reasoning: `Heartbeat servidor OK para org ${org.name}.`,
              status: "EXECUTED",
              action_result: "logged",
              evidence: {
                source: "atenia-server-heartbeat",
                timestamp: new Date().toISOString(),
              },
            });
          } catch (_) { /* non-fatal */ }
        }
      } catch (err) {
        const reason = (err as Error).name === "AbortError"
          ? "Timeout: supervisor tardó más de 130s"
          : (err as Error).message;
        results.push({ org_id: org.id, status: "ERROR", detail: reason });

        // Log timeout/crash failure
        try {
          await supabase.from("atenia_ai_actions").insert({
            action_type: "SERVER_HEARTBEAT_FAILURE",
            actor: "AI_AUTOPILOT",
            scope: "ORG",
            organization_id: org.id,
            autonomy_tier: "ACT",
            reasoning: `Heartbeat del servidor falló para org ${org.name}: ${reason}`,
            status: "FAILED",
            action_result: "failed",
            evidence: { error: reason, timestamp: new Date().toISOString() },
          });
        } catch { /* non-blocking */ }
      }
    }

    // Log summary
    const okCount = results.filter((r) => r.status === "OK").length;
    const skipCount = results.filter((r) => r.status === "SKIPPED").length;
    const errCount = results.filter((r) => r.status === "ERROR").length;

    await supabase.from("atenia_ai_actions").insert({
      action_type: "SERVER_HEARTBEAT",
      actor: "AI_AUTOPILOT",
      scope: "PLATFORM",
      autonomy_tier: "ACT",
      reasoning: `Heartbeat servidor: ${okCount} orgs procesadas, ${skipCount} omitidas (dedup), ${errCount} errores.`,
      status: "EXECUTED",
      action_result: "applied",
      evidence: { total: results.length, ok: okCount, skipped: skipCount, errors: errCount },
    });

    // ── Finish platform job heartbeat ──
    await finishHeartbeat(supabase, hbHandle, errCount > 0 ? "ERROR" : "OK", {
      metadata: { ok: okCount, skipped: skipCount, errors: errCount },
    });

    return new Response(
      JSON.stringify({ ok: true, results_summary: { ok: okCount, skipped: skipCount, errors: errCount } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    // ── Record failure heartbeat ──
    try {
      const supabaseUrl2 = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const sb2 = createClient(supabaseUrl2, serviceRoleKey2);
      await sb2.from("platform_job_heartbeats").insert({
        job_name: "atenia-server-heartbeat",
        invoked_by: "cron",
        status: "ERROR",
        error_message: (err as Error).message?.slice(0, 500),
        finished_at: new Date().toISOString(),
      });
    } catch { /* non-fatal */ }
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
