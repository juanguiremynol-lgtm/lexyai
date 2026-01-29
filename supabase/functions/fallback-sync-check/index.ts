import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Workflows that support external API sync
const SYNC_ENABLED_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'];

// Terminal stages that don't need syncing
const TERMINAL_STAGES = [
  'ARCHIVADO',
  'FINALIZADO',
  'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO',
  'FINALIZADO_ABSUELTO',
  'FINALIZADO_CONDENADO'
];

/**
 * Fallback sync check - runs every 4 hours
 * Catches any missed syncs from the daily job
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[fallback-sync-check] Starting fallback check...");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if daily sync ran today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: todayJobs, error: jobError } = await supabase
      .from("job_runs")
      .select("id, status, finished_at, metadata")
      .eq("job_name", "scheduled-daily-sync")
      .gte("started_at", todayStart.toISOString())
      .order("started_at", { ascending: false })
      .limit(1);

    if (jobError) {
      console.error("[fallback-sync-check] Error checking job runs:", jobError);
    }

    const dailySyncRanToday = todayJobs && todayJobs.length > 0 &&
      todayJobs[0].status === 'OK';

    console.log("[fallback-sync-check] Daily sync ran today:", dailySyncRanToday);

    // If daily sync didn't run, trigger it
    if (!dailySyncRanToday) {
      console.log("[fallback-sync-check] Daily sync missed! Triggering fallback...");

      const { data, error } = await supabase.functions.invoke("scheduled-daily-sync");

      if (error) {
        console.error("[fallback-sync-check] Failed to trigger fallback sync:", error);
        return new Response(
          JSON.stringify({
            ok: false,
            action: "FALLBACK_TRIGGER_FAILED",
            error: error.message,
            duration_ms: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          action: "FALLBACK_TRIGGERED",
          sync_results: data,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for work items that haven't been synced in 24+ hours
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { data: staleItems, error: staleError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, organization_id")
      .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
      .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .not("radicado", "is", null)
      .eq("monitoring_enabled", true)
      .or(`last_synced_at.is.null,last_synced_at.lt.${twentyFourHoursAgo.toISOString()}`)
      .limit(30); // Limit to prevent timeout

    if (staleError) {
      console.error("[fallback-sync-check] Error fetching stale items:", staleError);
      throw staleError;
    }

    // Filter valid radicados
    const validStaleItems = (staleItems || []).filter(item =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    if (validStaleItems.length > 0) {
      console.log("[fallback-sync-check] Found", validStaleItems.length, "stale items, syncing...");

      let synced = 0;
      let errors = 0;

      for (const item of validStaleItems) {
        try {
          await supabase.functions.invoke("sync-by-work-item", {
            body: { work_item_id: item.id },
          });

          // Update last_synced_at
          await supabase
            .from("work_items")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", item.id);

          synced++;
        } catch (e) {
          console.error("[fallback-sync-check] Failed to sync item:", item.id, e);
          errors++;
        }

        // Rate limit: 500ms between syncs
        await new Promise((r) => setTimeout(r, 500));

        // Check for timeout (55 seconds)
        if (Date.now() - startTime > 55000) {
          console.log("[fallback-sync-check] Approaching timeout, stopping early");
          break;
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          action: "STALE_ITEMS_SYNCED",
          stale_items_found: validStaleItems.length,
          synced,
          errors,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "NO_ACTION_NEEDED",
        message: "Daily sync completed and no stale items found",
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[fallback-sync-check] Fatal error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err.message || String(err),
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
