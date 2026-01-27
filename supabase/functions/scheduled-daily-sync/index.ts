import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Scheduled function that runs daily at 7 AM COT (12 PM UTC)
 * Syncs all active work items with monitoring enabled
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[scheduled-daily-sync] Starting daily sync...");

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active work items that need sync
    // Exclude archived/final stages, only sync items with monitoring enabled
    const { data: workItems, error: fetchError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, stage, last_checked_at, organization_id")
      .eq("monitoring_enabled", true)
      .not("stage", "in", '("ARCHIVADO","EJECUTORIADO","TERMINADO")')
      .or("last_checked_at.is.null,last_checked_at.lt.now() - interval '23 hours'")
      .limit(100); // Safety limit

    if (fetchError) {
      console.error("[scheduled-daily-sync] Error fetching work items:", fetchError);
      throw fetchError;
    }

    console.log(`[scheduled-daily-sync] Found ${workItems?.length || 0} work items to sync`);

    if (!workItems || workItems.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "No work items to sync",
          synced: 0,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sync each work item with rate limiting
    let successCount = 0;
    let errorCount = 0;
    let scrapingInitiatedCount = 0;
    const errors: Array<{ work_item_id: string; radicado: string | null; error: string }> = [];

    for (const workItem of workItems) {
      try {
        console.log(`[scheduled-daily-sync] Syncing: ${workItem.id} (${workItem.radicado})`);

        // Call sync-by-work-item function
        const { data: syncResult, error: syncError } = await supabase.functions.invoke(
          "sync-by-work-item",
          {
            body: { work_item_id: workItem.id },
          }
        );

        if (syncError) {
          throw syncError;
        }

        // If scraping was initiated, count separately
        if (syncResult?.scraping_initiated) {
          console.log(`[scheduled-daily-sync] Scraping initiated for ${workItem.radicado}`);
          scrapingInitiatedCount++;
          continue;
        }

        if (syncResult?.ok) {
          console.log(
            `[scheduled-daily-sync] ✅ Synced ${workItem.radicado}: ${syncResult.inserted_count || 0} new`
          );
          successCount++;
        } else {
          throw new Error(syncResult?.message || "Unknown sync error");
        }
      } catch (error: any) {
        console.error(`[scheduled-daily-sync] ❌ Error syncing ${workItem.radicado}:`, error);
        errorCount++;
        errors.push({
          work_item_id: workItem.id,
          radicado: workItem.radicado,
          error: error.message || String(error),
        });
      }

      // Rate limit: wait 1 second between syncs to avoid overloading external APIs
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[scheduled-daily-sync] Completed in ${durationMs}ms: ${successCount} success, ${scrapingInitiatedCount} scraping, ${errorCount} errors`
    );

    // Log execution to job_runs table if it exists
    try {
      await supabase.from("job_runs").insert({
        job_name: "scheduled-daily-sync",
        status: errorCount === 0 ? "OK" : "PARTIAL",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: workItems.length,
        metadata: {
          success_count: successCount,
          scraping_initiated: scrapingInitiatedCount,
          error_count: errorCount,
          errors: errors.slice(0, 10), // Limit stored errors
        },
      });
    } catch (logError) {
      console.warn("[scheduled-daily-sync] Failed to log to job_runs:", logError);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily sync completed",
        total: workItems.length,
        synced: successCount,
        scraping_initiated: scrapingInitiatedCount,
        errors: errorCount,
        error_details: errors.length > 0 ? errors.slice(0, 10) : undefined,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[scheduled-daily-sync] Fatal error:", error);

    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message || String(error),
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
