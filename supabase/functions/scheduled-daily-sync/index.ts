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
 * Scheduled function that runs daily at 7 AM COT (12 PM UTC)
 * Syncs all active work items with monitoring enabled
 * Enhanced to sync BOTH actuaciones (CPNU/SAMAI) AND publicaciones
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[scheduled-daily-sync] Starting daily sync...");
  console.log("[scheduled-daily-sync] Time:", new Date().toISOString());

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all active work items that need sync
    // Sync all eligible items (monitoring_enabled, valid radicado, not terminal)
    const { data: workItems, error: fetchError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, stage, last_synced_at, organization_id, owner_id")
      .eq("monitoring_enabled", true)
      .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
      .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .not("radicado", "is", null)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(200); // Safety limit

    if (fetchError) {
      console.error("[scheduled-daily-sync] Error fetching work items:", fetchError);
      throw fetchError;
    }

    // Filter to valid 23-digit radicados
    const eligibleItems = (workItems || []).filter(item =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    console.log(`[scheduled-daily-sync] Found ${eligibleItems.length} eligible work items to sync`);

    if (eligibleItems.length === 0) {
      // Log successful completion even with no items
      await logJobRun(supabase, startTime, {
        status: "OK",
        total: 0,
        synced: 0,
        scraping_initiated: 0,
        errors: 0,
        message: "No work items to sync"
      });

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
    let publicacionesSynced = 0;
    const errors: Array<{ work_item_id: string; radicado: string | null; error: string }> = [];

    for (const workItem of eligibleItems) {
      try {
        console.log(`[scheduled-daily-sync] Syncing: ${workItem.id} (${workItem.radicado})`);

        // Call sync-by-work-item function (CPNU/SAMAI actuaciones)
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
        if (syncResult?.scraping_initiated || syncResult?.code === 'SCRAPING_INITIATED') {
          console.log(`[scheduled-daily-sync] Scraping initiated for ${workItem.radicado}`);
          scrapingInitiatedCount++;
        } else if (syncResult?.ok) {
          console.log(
            `[scheduled-daily-sync] ✅ Synced ${workItem.radicado}: ${syncResult.inserted_count || 0} new actuaciones`
          );
          successCount++;
        }

        // Also sync publicaciones for eligible workflows
        if (['CGP', 'LABORAL', 'CPACA', 'PENAL_906'].includes(workItem.workflow_type)) {
          try {
            const { data: pubResult } = await supabase.functions.invoke(
              "sync-publicaciones-by-work-item",
              {
                body: { work_item_id: workItem.id },
              }
            );
            if (pubResult?.ok) {
              publicacionesSynced++;
              console.log(
                `[scheduled-daily-sync] ✅ Publicaciones synced for ${workItem.radicado}: ${pubResult.inserted_count || 0} new`
              );
            }
          } catch (pubError) {
            console.warn(`[scheduled-daily-sync] Publicaciones sync failed for ${workItem.radicado}:`, pubError);
          }
        }

        // Update last_synced_at
        await supabase
          .from("work_items")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("id", workItem.id);

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

      // Check for timeout (55 seconds to be safe)
      if (Date.now() - startTime > 55000) {
        console.log("[scheduled-daily-sync] Approaching timeout, stopping early");
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[scheduled-daily-sync] Completed in ${durationMs}ms: ${successCount} success, ${scrapingInitiatedCount} scraping, ${publicacionesSynced} publicaciones, ${errorCount} errors`
    );

    // Log execution to job_runs table
    await logJobRun(supabase, startTime, {
      status: errorCount === 0 ? "OK" : "PARTIAL",
      total: eligibleItems.length,
      synced: successCount,
      scraping_initiated: scrapingInitiatedCount,
      publicaciones_synced: publicacionesSynced,
      errors: errorCount,
      error_details: errors.slice(0, 10)
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily sync completed",
        total: eligibleItems.length,
        synced: successCount,
        scraping_initiated: scrapingInitiatedCount,
        publicaciones_synced: publicacionesSynced,
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

async function logJobRun(
  supabase: any,
  startTime: number,
  metadata: Record<string, any>
): Promise<void> {
  try {
    await supabase.from("job_runs").insert({
      job_name: "scheduled-daily-sync",
      status: metadata.status || "OK",
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      processed_count: metadata.total || 0,
      metadata: {
        success_count: metadata.synced || 0,
        scraping_initiated: metadata.scraping_initiated || 0,
        publicaciones_synced: metadata.publicaciones_synced || 0,
        error_count: metadata.errors || 0,
        errors: metadata.error_details || [],
      },
    });
  } catch (logError) {
    console.warn("[scheduled-daily-sync] Failed to log to job_runs:", logError);
  }
}
