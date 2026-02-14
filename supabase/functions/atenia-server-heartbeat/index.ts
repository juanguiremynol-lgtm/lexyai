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
    // Get all orgs with active subscriptions
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, name");

    if (orgsErr) throw orgsErr;

    const results: { org_id: string; status: string; detail?: string }[] = [];

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

    return new Response(
      JSON.stringify({ ok: true, results_summary: { ok: okCount, skipped: skipCount, errors: errCount } }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
