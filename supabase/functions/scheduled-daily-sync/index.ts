import { createClient } from "npm:@supabase/supabase-js@2";

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
Deno.serve(async (req) => {
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

    // Trigger Atenia AI Supervisor for post-sync analysis (fire and forget)
    try {
      console.log("[scheduled-daily-sync] Triggering Atenia AI Supervisor...");
      supabase.functions.invoke("atenia-ai-supervisor", {
        body: { mode: "POST_DAILY_SYNC" },
      }).then((res: any) => {
        if (res.error) console.warn("[scheduled-daily-sync] Atenia AI error:", res.error);
        else console.log("[scheduled-daily-sync] Atenia AI supervisor triggered successfully");
      }).catch((err: any) => {
        console.warn("[scheduled-daily-sync] Atenia AI invoke failed:", err);
      });
    } catch (ateniaErr) {
      console.warn("[scheduled-daily-sync] Atenia AI trigger error:", ateniaErr);
    }

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
  let itemsSkipped = 0;
  let publicacionesSynced = 0;
  let scrapingInitiated = 0;
  let totalInserted = 0;
  let totalPubInserted = 0;
  const syncStartTime = Date.now();

  const BATCH_SIZE = 3;
  const PUBLICACIONES_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'];

  try {
    // Get all active work items for this org
    const { data: workItems, error: fetchError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, stage, last_synced_at")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
      .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
      .not("radicado", "is", null)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(50); // Increased from 30 — parallel batching handles throughput

    if (fetchError) {
      throw fetchError;
    }

    // Filter to valid 23-digit radicados
    const eligibleItems = (workItems || []).filter((item: any) =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    // === 404 COOLDOWN: deprioritize items that got PROVIDER_404 in last 48h ===
    let sortedItems = [...eligibleItems];
    if (sortedItems.length > 0) {
      const itemIds = sortedItems.map((w: any) => w.id);
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: recent404s } = await supabase
        .from("sync_traces")
        .select("work_item_id")
        .in("work_item_id", itemIds)
        .eq("error_code", "PROVIDER_404")
        .gte("created_at", fortyEightHoursAgo);

      if (recent404s && recent404s.length > 0) {
        const cooldownIds = new Set(recent404s.map((r: any) => r.work_item_id));
        const priorityItems = sortedItems.filter((w: any) => !cooldownIds.has(w.id));
        const cooldownItems = sortedItems.filter((w: any) => cooldownIds.has(w.id));
        sortedItems = [...priorityItems, ...cooldownItems];
        if (cooldownItems.length > 0) {
          console.log(`[scheduled-daily-sync] ${cooldownItems.length} items in 404 cooldown (deprioritized)`);
        }
      }
    }

    console.log(`[scheduled-daily-sync] Org ${orgId}: ${sortedItems.length} eligible items (batch size ${BATCH_SIZE})`);

    // Update ledger with targeted count
    await supabase.rpc('update_daily_sync_ledger', {
      p_ledger_id: ledgerId,
      p_status: 'RUNNING',
      p_items_targeted: sortedItems.length
    });

    // === PARALLEL BATCH PROCESSING ===
    for (let i = 0; i < sortedItems.length; i += BATCH_SIZE) {
      // Check if we're approaching the function timeout (keep 10s buffer)
      const elapsedMs = Date.now() - syncStartTime;
      if (elapsedMs > 48000) {
        console.warn(`[scheduled-daily-sync] Timeout approaching after ${i}/${sortedItems.length} items, stopping batch`);
        itemsSkipped += (sortedItems.length - i);
        break;
      }

      // Also check global timeout
      if (Date.now() - globalStartTime > 48000) {
        console.log("[scheduled-daily-sync] Global timeout, stopping batch");
        itemsSkipped += (sortedItems.length - i);
        break;
      }

      const batch = sortedItems.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.allSettled(
        batch.map(async (workItem: any) => {
          const itemStart = Date.now();
          try {
            // Sync actuaciones
            const { data: syncResult, error: syncError } = await supabase.functions.invoke(
              "sync-by-work-item",
              { body: { work_item_id: workItem.id, _scheduled: true } }
            );

            if (syncError) {
              throw syncError;
            }

            // Sync publicaciones (only for eligible workflows)
            let pubResult: any = null;
            let pubInserted = 0;
            if (PUBLICACIONES_WORKFLOWS.includes(workItem.workflow_type)) {
              try {
                const { data: pr } = await supabase.functions.invoke(
                  "sync-publicaciones-by-work-item",
                  { body: { work_item_id: workItem.id } }
                );
                pubResult = pr;
                pubInserted = pr?.inserted_count || 0;
              } catch {
                // Publicaciones errors don't count as failures
              }
            }

            // Update last_synced_at if sync was genuinely successful
            const syncWasSuccessful = syncResult?.ok === true;
            const hadNewData = (syncResult?.inserted_count || 0) > 0 || pubInserted > 0;
            const providerReturnedEmpty = syncWasSuccessful && !hadNewData;

            if (hadNewData || providerReturnedEmpty) {
              await supabase
                .from("work_items")
                .update({ last_synced_at: new Date().toISOString() })
                .eq("id", workItem.id);
            }

            return {
              work_item_id: workItem.id,
              radicado: workItem.radicado,
              actSuccess: syncResult?.ok === true,
              scrapingInitiated: syncResult?.scraping_initiated || syncResult?.code === 'SCRAPING_INITIATED',
              pubSuccess: pubResult?.ok === true || pubResult === null,
              latencyMs: Date.now() - itemStart,
              inserted_count: syncResult?.inserted_count || 0,
              pub_inserted: pubInserted,
            };
          } catch (err: any) {
            return {
              work_item_id: workItem.id,
              radicado: workItem.radicado,
              actSuccess: false,
              scrapingInitiated: false,
              pubSuccess: false,
              latencyMs: Date.now() - itemStart,
              inserted_count: 0,
              pub_inserted: 0,
              error: err?.message || 'unknown',
            };
          }
        })
      );

      // Process batch results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const val = result.value;
          if (val.scrapingInitiated) {
            scrapingInitiated++;
          } else if (val.actSuccess) {
            successCount++;
          } else {
            errorCount++;
            console.error(`[scheduled-daily-sync] Item ${val.work_item_id} failed:`, val.error || 'actSuccess=false');
          }
          totalInserted += val.inserted_count;
          totalPubInserted += val.pub_inserted;
          if (val.pubSuccess && val.pub_inserted > 0) publicacionesSynced++;
        } else {
          errorCount++;
          console.error(`[scheduled-daily-sync] Batch item rejected:`, result.reason?.message);
        }
      }

      // Heartbeat the ledger after each batch
      await supabase.rpc('update_daily_sync_ledger', {
        p_ledger_id: ledgerId,
        p_status: 'RUNNING',
        p_items_succeeded: successCount + scrapingInitiated,
        p_items_failed: errorCount
      });
    }

    // Determine final status (accounting for skipped items)
    const totalProcessed = successCount + scrapingInitiated + errorCount;
    const totalItems = sortedItems.length;
    const successRate = totalProcessed > 0 ? (successCount + scrapingInitiated) / totalProcessed : 0;

    let finalStatus: string;
    if (successCount + scrapingInitiated === totalItems) {
      finalStatus = 'SUCCESS';
    } else if (successRate >= SUCCESS_THRESHOLD && itemsSkipped === 0) {
      finalStatus = 'SUCCESS';
    } else if (successCount + scrapingInitiated > 0) {
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
        items_skipped: itemsSkipped,
        total_inserted: totalInserted,
        total_pub_inserted: totalPubInserted,
        success_rate: successRate,
        batch_size: BATCH_SIZE,
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
