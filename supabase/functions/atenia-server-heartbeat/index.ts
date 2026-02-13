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

        // Invoke the supervisor in HEARTBEAT mode
        const { error: invokeErr } = await supabase.functions.invoke(
          "atenia-ai-supervisor",
          {
            body: {
              mode: "HEARTBEAT",
              organization_id: org.id,
            },
          }
        );

        if (invokeErr) {
          results.push({ org_id: org.id, status: "ERROR", detail: invokeErr.message });

          // Log failure
          await supabase.from("atenia_ai_actions").insert({
            action_type: "SERVER_HEARTBEAT_FAILURE",
            actor: "AI_AUTOPILOT",
            scope: "ORG",
            organization_id: org.id,
            autonomy_tier: "ACT",
            reasoning: `Heartbeat del servidor falló para org ${org.name}: ${invokeErr.message}`,
            status: "FAILED",
            action_result: "failed",
          });
        } else {
          results.push({ org_id: org.id, status: "OK" });
        }
      } catch (err) {
        results.push({ org_id: org.id, status: "ERROR", detail: (err as Error).message });
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
