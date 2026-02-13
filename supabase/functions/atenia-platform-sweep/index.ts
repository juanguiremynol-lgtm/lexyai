/**
 * atenia-platform-sweep — Daily cross-org platform health sweep.
 *
 * Runs at 8:00 AM COT (13:00 UTC), 1 hour after daily sync.
 * Checks ALL orgs for: daily sync completion, freshness violations,
 * heartbeat staleness, and generates admin daily digest.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface OrgSweepResult {
  org_id: string;
  org_name: string;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  total_monitored_items: number;
  synced_in_sla: number;
  freshness_violations: number;
  critical_violations: number;
  daily_sync_status: string;
  heartbeat_stale: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, name");

    const today = new Date().toISOString().slice(0, 10);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const sweepResults: OrgSweepResult[] = [];

    for (const org of orgs ?? []) {
      try {
        // Check daily sync status
        const { data: todaySync } = await supabase
          .from("auto_sync_daily_ledger")
          .select("status")
          .eq("organization_id", org.id)
          .eq("run_date", today)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const dailySyncStatus = todaySync?.status ?? "NOT_RUN";

        // Check heartbeat staleness
        const { data: lastHeartbeat } = await supabase
          .from("atenia_ai_actions")
          .select("created_at")
          .eq("action_type", "heartbeat_observe")
          .eq("organization_id", org.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const heartbeatStale = !lastHeartbeat || lastHeartbeat.created_at < fourHoursAgo;

        // Count monitored items and violations
        const { count: totalMonitored } = await supabase
          .from("work_items")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("monitoring_enabled", true)
          .is("deleted_at", null);

        const { count: violations } = await supabase
          .from("work_items")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("monitoring_enabled", true)
          .is("deleted_at", null)
          .not("freshness_violation_at", "is", null);

        const { count: criticalViolations } = await supabase
          .from("work_items")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", org.id)
          .eq("monitoring_enabled", true)
          .is("deleted_at", null)
          .not("freshness_violation_at", "is", null)
          .eq("freshness_tier", "CRITICAL");

        const total = totalMonitored ?? 0;
        const viols = violations ?? 0;
        const critViols = criticalViolations ?? 0;
        const syncedInSla = total - viols;

        const orgStatus: OrgSweepResult["status"] =
          critViols > 0 ? "CRITICAL" : viols > 0 || heartbeatStale ? "DEGRADED" : "HEALTHY";

        sweepResults.push({
          org_id: org.id,
          org_name: org.name ?? org.id.slice(0, 8),
          status: orgStatus,
          total_monitored_items: total,
          synced_in_sla: syncedInSla,
          freshness_violations: viols,
          critical_violations: critViols,
          daily_sync_status: dailySyncStatus,
          heartbeat_stale: heartbeatStale,
        });

        // If org has critical violations and heartbeat is stale, trigger corrective sync
        if (critViols > 0 && heartbeatStale) {
          const { data: critItems } = await supabase
            .from("work_items")
            .select("id")
            .eq("organization_id", org.id)
            .eq("monitoring_enabled", true)
            .is("deleted_at", null)
            .not("freshness_violation_at", "is", null)
            .eq("freshness_tier", "CRITICAL")
            .limit(5);

          for (const item of critItems ?? []) {
            try {
              await supabase.functions.invoke("sync-by-work-item", {
                body: { work_item_id: item.id, trigger: "PLATFORM_SWEEP" },
              });
            } catch { /* non-blocking */ }
          }
        }
      } catch (err) {
        sweepResults.push({
          org_id: org.id,
          org_name: org.name ?? "?",
          status: "CRITICAL",
          total_monitored_items: 0,
          synced_in_sla: 0,
          freshness_violations: 0,
          critical_violations: 0,
          daily_sync_status: "ERROR",
          heartbeat_stale: true,
        });
      }
    }

    // Generate digest
    const totalOrgs = sweepResults.length;
    const orgsOk = sweepResults.filter((r) => r.status === "HEALTHY").length;
    const orgsDegraded = sweepResults.filter((r) => r.status === "DEGRADED").length;
    const orgsCritical = sweepResults.filter((r) => r.status === "CRITICAL").length;
    const totalItems = sweepResults.reduce((s, r) => s + r.total_monitored_items, 0);
    const totalSynced = sweepResults.reduce((s, r) => s + r.synced_in_sla, 0);
    const totalViolations = sweepResults.reduce((s, r) => s + r.freshness_violations, 0);
    const totalCritical = sweepResults.reduce((s, r) => s + r.critical_violations, 0);
    const syncRate = totalItems > 0 ? Math.round((totalSynced / totalItems) * 100 * 100) / 100 : 100;

    const platformHealth: "HEALTHY" | "DEGRADED" | "CRITICAL" =
      orgsCritical > 0 ? "CRITICAL" : orgsDegraded > 0 ? "DEGRADED" : "HEALTHY";

    // Get action counts
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: actionsExecuted } = await supabase
      .from("atenia_ai_actions")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneDayAgo)
      .in("actor", ["AI_AUTOPILOT", "AI_WATCHDOG"]);

    // Generate markdown digest
    let digest = `# Informe Diario de Atenia AI — ${new Date().toLocaleDateString("es-CO")}\n\n`;
    digest += `## Resumen de Plataforma\n`;
    digest += `- **Organizaciones:** ${totalOrgs} total (${orgsOk} saludables, ${orgsDegraded} degradadas, ${orgsCritical} críticas)\n`;
    digest += `- **Asuntos monitoreados:** ${totalItems}\n`;
    digest += `- **Tasa de frescura en SLA:** ${syncRate}% (${totalSynced}/${totalItems})\n`;
    digest += `- **Violaciones de frescura:** ${totalViolations} (${totalCritical} críticas)\n`;
    digest += `- **Acciones autónomas (24h):** ${actionsExecuted ?? 0}\n\n`;

    if (orgsCritical > 0) {
      digest += `## ⚠️ Organizaciones que Requieren Atención\n`;
      for (const r of sweepResults.filter((r) => r.status === "CRITICAL")) {
        digest += `- **${r.org_name}:** ${r.critical_violations} CRÍTICOS, sync: ${r.daily_sync_status}, heartbeat: ${r.heartbeat_stale ? "STALE" : "OK"}\n`;
      }
      digest += "\n";
    }

    digest += `## Detalle por Organización\n`;
    for (const r of sweepResults) {
      const icon = r.status === "HEALTHY" ? "🟢" : r.status === "DEGRADED" ? "🟡" : "🔴";
      digest += `- ${icon} **${r.org_name}:** ${r.total_monitored_items} items, ${Math.round((r.synced_in_sla / Math.max(r.total_monitored_items, 1)) * 100)}% en SLA\n`;
    }

    // Store digest
    await supabase.from("admin_daily_digests").upsert({
      digest_date: today,
      content_markdown: digest,
      summary_data: { sweep_results: sweepResults },
      platform_health: platformHealth,
      total_orgs: totalOrgs,
      total_items_monitored: totalItems,
      freshness_sla_rate: syncRate,
      critical_violations: totalCritical,
      actions_executed_24h: actionsExecuted ?? 0,
      generated_at: new Date().toISOString(),
    }, { onConflict: "digest_date" });

    // Log sweep action
    await supabase.from("atenia_ai_actions").insert({
      action_type: "PLATFORM_DAILY_SWEEP",
      actor: "AI_AUTOPILOT",
      scope: "PLATFORM",
      autonomy_tier: "ACT",
      reasoning: `Barrido diario: ${totalOrgs} orgs, ${totalItems} items, ${syncRate}% en SLA, ${totalCritical} violaciones críticas.`,
      status: "EXECUTED",
      action_result: "applied",
      evidence: {
        total_orgs: totalOrgs,
        orgs_ok: orgsOk,
        orgs_degraded: orgsDegraded,
        orgs_critical: orgsCritical,
        total_items: totalItems,
        sync_rate: syncRate,
        critical_violations: totalCritical,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        platform_health: platformHealth,
        total_orgs: totalOrgs,
        sync_rate: syncRate,
        critical_violations: totalCritical,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
