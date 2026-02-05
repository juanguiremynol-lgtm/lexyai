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

// Success threshold for PARTIAL vs SUCCESS
const SUCCESS_THRESHOLD = 0.9; // 90%

/**
 * Scheduled function that runs daily at 7 AM COT (12 PM UTC)
 * Syncs all active work items with monitoring enabled
 * Enhanced with per-org ledger tracking and idempotency
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[scheduled-daily-sync] Starting daily sync (run_id: ${runId})`);
  console.log("[scheduled-daily-sync] Time:", new Date().toISOString());

  try {
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all organizations that have active work items needing sync
    const { data: orgsWithItems, error: orgsError } = await supabase
      .from("work_items")
      .select("organization_id")
      .eq("monitoring_enabled", true)
      .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
      .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .not("radicado", "is", null)
      .not("organization_id", "is", null);

    if (orgsError) {
      console.error("[scheduled-daily-sync] Error fetching orgs:", orgsError);
      throw orgsError;
    }

    // Get unique organization IDs
    const orgIds = [...new Set((orgsWithItems || []).map(item => item.organization_id).filter(Boolean))];
    console.log(`[scheduled-daily-sync] Found ${orgIds.length} organizations with eligible items`);

    const allResults: Array<{
      org_id: string;
      status: string;
      synced: number;
      errors: number;
      ledger_id?: string;
    }> = [];

    // Process each organization with ledger tracking
    for (const orgId of orgIds) {
      try {
        const orgResult = await syncOrganization(supabase, orgId, runId, startTime);
        allResults.push(orgResult);
      } catch (orgError: any) {
        console.error(`[scheduled-daily-sync] Org ${orgId} failed:`, orgError);
        allResults.push({
          org_id: orgId,
          status: 'FAILED',
          synced: 0,
          errors: 1
        });
      }

      // Check for timeout (50 seconds to allow cleanup)
      if (Date.now() - startTime > 50000) {
        console.log("[scheduled-daily-sync] Approaching timeout, stopping org iteration");
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const totalSynced = allResults.reduce((sum, r) => sum + r.synced, 0);
    const totalErrors = allResults.reduce((sum, r) => sum + r.errors, 0);
    const successfulOrgs = allResults.filter(r => r.status === 'SUCCESS').length;
    const failedOrgs = allResults.filter(r => r.status === 'FAILED');

    console.log(
      `[scheduled-daily-sync] Completed in ${durationMs}ms: ${successfulOrgs}/${orgIds.length} orgs successful, ${totalSynced} items synced, ${totalErrors} errors`
    );

    // FIX 5.2: Create alert_instances for failed orgs
    if (failedOrgs.length > 0) {
      console.log(`[scheduled-daily-sync] Creating failure alerts for ${failedOrgs.length} orgs`);
      for (const failedOrg of failedOrgs) {
        try {
          // Find an admin user for this org to own the alert
          const { data: membership } = await supabase
            .from('organization_memberships')
            .select('user_id')
            .eq('organization_id', failedOrg.org_id)
            .eq('role', 'admin')
            .limit(1)
            .maybeSingle();

          if (membership?.user_id) {
            await supabase.from('alert_instances').insert({
              owner_id: membership.user_id,
              organization_id: failedOrg.org_id,
              entity_type: 'SYSTEM',
              entity_id: failedOrg.org_id,
              severity: 'WARNING',
              status: 'ACTIVE',
              title: 'Sincronización diaria fallida',
              message: `La sincronización automática de ${new Date().toLocaleDateString('es-CO')} falló. ${failedOrg.errors} error(es). El sistema reintentará automáticamente.`,
              payload: {
                run_id: runId,
                errors: failedOrg.errors,
                synced: failedOrg.synced,
                ledger_id: failedOrg.ledger_id,
              },
              fingerprint: `sync_failed_${failedOrg.org_id}_${new Date().toISOString().slice(0, 10)}`,
            });
            console.log(`[scheduled-daily-sync] Alert created for org ${failedOrg.org_id}`);
          }
        } catch (alertError) {
          console.warn(`[scheduled-daily-sync] Failed to create alert for org ${failedOrg.org_id}:`, alertError);
        }
      }
    }

    // Log execution to job_runs table (legacy compatibility)
    await logJobRun(supabase, startTime, {
      status: totalErrors === 0 ? "OK" : "PARTIAL",
      total_orgs: orgIds.length,
      successful_orgs: successfulOrgs,
      total_synced: totalSynced,
      total_errors: totalErrors,
      run_id: runId,
      results: allResults.slice(0, 20)
    });

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Daily sync completed",
        run_id: runId,
        organizations_processed: orgIds.length,
        organizations_successful: successfulOrgs,
        total_synced: totalSynced,
        total_errors: totalErrors,
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
        run_id: runId,
        duration_ms: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Sync a single organization with ledger tracking
 */
async function syncOrganization(
  supabase: any,
  orgId: string,
  runId: string,
  globalStartTime: number
): Promise<{
  org_id: string;
  status: string;
  synced: number;
  errors: number;
  ledger_id?: string;
}> {
  console.log(`[scheduled-daily-sync] Processing org: ${orgId}`);

  // Try to acquire lock via ledger
  const { data: lockResult, error: lockError } = await supabase.rpc('acquire_daily_sync_lock', {
    p_organization_id: orgId,
    p_run_id: runId
  });

  if (lockError) {
    console.error(`[scheduled-daily-sync] Lock error for org ${orgId}:`, lockError);
    throw lockError;
  }

  const lock = lockResult as { acquired: boolean; ledger_id: string; status: string; reason?: string };

  if (!lock.acquired) {
    console.log(`[scheduled-daily-sync] Skipping org ${orgId}: ${lock.reason}`);
    return {
      org_id: orgId,
      status: lock.status,
      synced: 0,
      errors: 0,
      ledger_id: lock.ledger_id
    };
  }

  const ledgerId = lock.ledger_id;
  let successCount = 0;
  let errorCount = 0;
  let publicacionesSynced = 0;
  let scrapingInitiated = 0;

  try {
    // Get all active work items for this org
    // LIMIT reduced from 100 to account for longer polling times (up to 60s per item)
    const { data: workItems, error: fetchError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, stage, last_synced_at")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
      .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .not("radicado", "is", null)
      .order("last_synced_at", { ascending: true, nullsFirst: true }) // Oldest sync first
      .limit(30); // Reduced from 100 to 30 due to 60s polling per item

    if (fetchError) {
      throw fetchError;
    }

    // Filter to valid 23-digit radicados
    const eligibleItems = (workItems || []).filter((item: any) =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    console.log(`[scheduled-daily-sync] Org ${orgId}: ${eligibleItems.length} eligible items`);

    // Update ledger with targeted count
    await supabase.rpc('update_daily_sync_ledger', {
      p_ledger_id: ledgerId,
      p_status: 'RUNNING',
      p_items_targeted: eligibleItems.length
    });

    // Sync each work item
    for (const workItem of eligibleItems) {
      try {
        // Call sync-by-work-item function (CPNU/SAMAI actuaciones)
        const { data: syncResult, error: syncError } = await supabase.functions.invoke(
          "sync-by-work-item",
          { body: { work_item_id: workItem.id } }
        );

        if (syncError) {
          throw syncError;
        }

        if (syncResult?.scraping_initiated || syncResult?.code === 'SCRAPING_INITIATED') {
          scrapingInitiated++;
        } else if (syncResult?.ok) {
          successCount++;
        }

        // Also sync publicaciones for eligible workflows
        let pubInserted = 0;
        if (['CGP', 'LABORAL', 'CPACA', 'PENAL_906'].includes(workItem.workflow_type)) {
          try {
            const { data: pubResult } = await supabase.functions.invoke(
              "sync-publicaciones-by-work-item",
              { body: { work_item_id: workItem.id } }
            );
            if (pubResult?.ok) {
              publicacionesSynced++;
              pubInserted = pubResult.inserted_count || 0;
            }
          } catch {
            // Publicaciones errors don't count as failures
          }
        }

        // FIX 3.2: Only update last_synced_at if sync was genuinely successful
        // Distinguish between "no new data" (provider OK, 0 inserts) and "provider error"
        const syncWasSuccessful = syncResult?.ok === true;
        const hadNewData = (syncResult?.inserted_count || 0) > 0 || pubInserted > 0;
        const providerReturnedEmpty = syncWasSuccessful && !hadNewData;
        
        if (hadNewData || providerReturnedEmpty) {
          // Provider responded successfully — safe to update timestamp
          await supabase
            .from("work_items")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", workItem.id);
        } else {
          // Provider error or scraping initiated — don't push to back of queue
          console.log(`[scheduled-daily-sync] Skipping last_synced_at update for ${workItem.id} (sync not confirmed successful)`);
        }

        // Heartbeat every few items
        if ((successCount + errorCount) % 10 === 0) {
          await supabase.rpc('update_daily_sync_ledger', {
            p_ledger_id: ledgerId,
            p_status: 'RUNNING',
            p_items_succeeded: successCount,
            p_items_failed: errorCount
          });
        }

      } catch (itemError: any) {
        console.error(`[scheduled-daily-sync] Item ${workItem.id} error:`, itemError);
        errorCount++;
      }

      // Rate limit: wait 1 second between syncs
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check for global timeout
      if (Date.now() - globalStartTime > 48000) {
        console.log("[scheduled-daily-sync] Global timeout, breaking item loop");
        break;
      }
    }

    // Determine final status
    const totalItems = eligibleItems.length;
    const processedItems = successCount + scrapingInitiated;
    const successRate = totalItems > 0 ? processedItems / totalItems : 1;
    
    let finalStatus: string;
    if (errorCount === 0 && successRate >= SUCCESS_THRESHOLD) {
      finalStatus = 'SUCCESS';
    } else if (processedItems > 0) {
      finalStatus = 'PARTIAL';
    } else {
      finalStatus = 'FAILED';
    }

    // Update ledger with final status
    await supabase.rpc('update_daily_sync_ledger', {
      p_ledger_id: ledgerId,
      p_status: finalStatus,
      p_items_succeeded: successCount + scrapingInitiated,
      p_items_failed: errorCount,
      p_metadata: {
        publicaciones_synced: publicacionesSynced,
        scraping_initiated: scrapingInitiated,
        success_rate: successRate
      }
    });

    return {
      org_id: orgId,
      status: finalStatus,
      synced: successCount + scrapingInitiated,
      errors: errorCount,
      ledger_id: ledgerId
    };

  } catch (error: any) {
    // Update ledger with error
    await supabase.rpc('update_daily_sync_ledger', {
      p_ledger_id: ledgerId,
      p_status: 'FAILED',
      p_items_succeeded: successCount,
      p_items_failed: errorCount,
      p_error: error.message || String(error)
    });

    throw error;
  }
}

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
      processed_count: metadata.total_synced || 0,
      metadata: {
        run_id: metadata.run_id,
        total_orgs: metadata.total_orgs,
        successful_orgs: metadata.successful_orgs,
        total_synced: metadata.total_synced,
        total_errors: metadata.total_errors,
        results: metadata.results
      },
    });
  } catch (logError) {
    console.warn("[scheduled-daily-sync] Failed to log to job_runs:", logError);
  }
}
