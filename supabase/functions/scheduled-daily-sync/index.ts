import { createClient } from "npm:@supabase/supabase-js@2";
import {
  shouldCountAsSuccess,
  shouldRunPublicaciones,
  isScrapingPending,
  shouldDemonitor,
  buildAuditEvidence,
  retryJitterMs,
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
  PUBLICACIONES_WORKFLOWS,
  DEFAULT_STALENESS_GUARD_DAYS,
} from "../_shared/syncPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
      .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
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
              status: 'PENDING',
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

  try {
    // Get all active work items for this org
    const { data: workItems, error: fetchError } = await supabase
      .from("work_items")
      .select("id, radicado, workflow_type, stage, last_synced_at, total_actuaciones, scrape_status, consecutive_failures")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
      .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
      .not("radicado", "is", null)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(100);

    if (fetchError) {
      throw fetchError;
    }

    // Filter to valid 23-digit radicados
    const eligibleItems = (workItems || []).filter((item: any) =>
      item.radicado && item.radicado.replace(/\D/g, '').length === 23
    );

    // === SKIP items with pending retries in sync_retry_queue ===
    let sortedItems = [...eligibleItems];
    if (sortedItems.length > 0) {
      const itemIds = sortedItems.map((w: any) => w.id);
      
      const { data: pendingRetries } = await (supabase.from("sync_retry_queue") as any)
        .select("work_item_id")
        .in("work_item_id", itemIds);

      if (pendingRetries && pendingRetries.length > 0) {
        const retryIds = new Set(pendingRetries.map((r: any) => r.work_item_id));
        const beforeCount = sortedItems.length;
        sortedItems = sortedItems.filter((w: any) => !retryIds.has(w.id));
        console.log(`[scheduled-daily-sync] Skipped ${beforeCount - sortedItems.length} items with pending retries`);
      }

      // === PRIORITY SORT ===
      // Cooldown sets: deprioritize items with recent 404s (48h) or recent empties (24h)
      let cooldownIds = new Set<string>();
      let emptyCooldownIds = new Set<string>();
      if (sortedItems.length > 0) {
        const remainingIds = sortedItems.map((w: any) => w.id);
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // 404 cooldown (48h)
        const { data: recent404s } = await supabase
          .from("sync_traces")
          .select("work_item_id")
          .in("work_item_id", remainingIds)
          .eq("error_code", "PROVIDER_404")
          .gte("created_at", fortyEightHoursAgo);

        if (recent404s && recent404s.length > 0) {
          cooldownIds = new Set(recent404s.map((r: any) => r.work_item_id));
        }

        // PROVIDER_EMPTY_RESULT cooldown (24h) — avoid burning sync budget on non-digitized cases
        const { data: recentEmpties } = await supabase
          .from("sync_traces")
          .select("work_item_id")
          .in("work_item_id", remainingIds)
          .eq("error_code", "PROVIDER_EMPTY_RESULT")
          .gte("created_at", twentyFourHoursAgo);

        if (recentEmpties && recentEmpties.length > 0) {
          emptyCooldownIds = new Set(recentEmpties.map((r: any) => r.work_item_id));
        }
      }

      sortedItems.sort((a: any, b: any) => {
        // Items in any cooldown go to the back
        const aCooldown = (cooldownIds.has(a.id) || emptyCooldownIds.has(a.id)) ? 1 : 0;
        const bCooldown = (cooldownIds.has(b.id) || emptyCooldownIds.has(b.id)) ? 1 : 0;
        if (aCooldown !== bCooldown) return aCooldown - bCooldown;

        const aFailed = (a.scrape_status === 'FAILED' || (a.consecutive_failures || 0) > 0) ? 0 : 1;
        const bFailed = (b.scrape_status === 'FAILED' || (b.consecutive_failures || 0) > 0) ? 0 : 1;
        if (aFailed !== bFailed) return aFailed - bFailed;

        const aNull = a.last_synced_at ? 1 : 0;
        const bNull = b.last_synced_at ? 1 : 0;
        if (aNull !== bNull) return aNull - bNull;

        const aDate = a.last_synced_at || '';
        const bDate = b.last_synced_at || '';
        if (aDate !== bDate) return aDate.localeCompare(bDate);

        return a.id.localeCompare(b.id);
      });

      const totalCooldown = new Set([...cooldownIds, ...emptyCooldownIds]).size;
      if (totalCooldown > 0) {
        console.log(`[scheduled-daily-sync] ${cooldownIds.size} items in 404 cooldown, ${emptyCooldownIds.size} in empty-result cooldown (deprioritized)`);
      }
    }

    // === RESUME CURSOR: Start from where we left off last run ===
    const cursorKey = `daily_sync_cursor_${orgId}`;
    let cursorItemId: string | null = null;

    try {
      const { data: cursorRow } = await (supabase.from('cron_state') as any)
        .select('value')
        .eq('key', cursorKey)
        .maybeSingle();
      
      if (cursorRow?.value?.cursor_work_item_id) {
        cursorItemId = cursorRow.value.cursor_work_item_id;
        const cursorIdx = sortedItems.findIndex((w: any) => w.id === cursorItemId);
        if (cursorIdx > 0) {
          const beforeCursor = sortedItems.slice(0, cursorIdx);
          const fromCursor = sortedItems.slice(cursorIdx);
          sortedItems = [...fromCursor, ...beforeCursor];
          console.log(`[scheduled-daily-sync] Resuming from cursor (idx=${cursorIdx}/${sortedItems.length})`);
        } else if (cursorIdx === -1) {
          console.log(`[scheduled-daily-sync] Cursor item no longer eligible, starting from top`);
        }
      }
    } catch (cursorErr) {
      console.warn(`[scheduled-daily-sync] Cursor read error:`, cursorErr);
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
      const elapsedMs = Date.now() - syncStartTime;
      if (elapsedMs > 48000) {
        console.warn(`[scheduled-daily-sync] Timeout approaching after ${i}/${sortedItems.length} items, stopping batch`);
        itemsSkipped += (sortedItems.length - i);
        break;
      }

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

            // ── Policy-driven pub sync gating ──
            let pubResult: any = null;
            let pubInserted = 0;
            if (
              shouldRunPublicaciones(syncResult) &&
              (PUBLICACIONES_WORKFLOWS as readonly string[]).includes(workItem.workflow_type)
            ) {
              if (workItem.workflow_type === 'PENAL_906') {
                try {
                  console.log(`[scheduled-daily-sync] PENAL_906: Enqueueing PUB_RETRY for ${workItem.radicado} (isolated invocation)`);
                  await (supabase.from('sync_retry_queue') as any).upsert({
                    work_item_id: workItem.id,
                    organization_id: orgId,
                    radicado: workItem.radicado,
                    workflow_type: workItem.workflow_type,
                    stage: workItem.stage || null,
                    kind: 'PUB_RETRY',
                    provider: 'publicaciones',
                    attempt: 1,
                    max_attempts: 3,
                    next_run_at: new Date(Date.now() + 10_000 + Math.floor(Math.random() * 10_000)).toISOString(),
                    last_error_code: null,
                    last_error_message: 'Enqueued by daily-sync for isolated execution',
                  }, { onConflict: 'work_item_id,kind' });
                } catch (enqueueErr) {
                  console.warn(`[scheduled-daily-sync] Failed to enqueue PUB_RETRY for ${workItem.id}:`, enqueueErr);
                }
              } else {
                try {
                  const isHeavy = (workItem.total_actuaciones || 0) >= 100;
                  if (isHeavy) {
                    console.log(`[scheduled-daily-sync] Heavy item ${workItem.radicado} (${workItem.total_actuaciones} acts), adding delay before pub sync`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                  }

                  const { data: pr } = await supabase.functions.invoke(
                    "sync-publicaciones-by-work-item",
                    { body: { work_item_id: workItem.id, _scheduled: true } }
                  );
                  pubResult = pr;
                  pubInserted = pr?.inserted_count || 0;
                } catch {
                  // Publicaciones errors don't count as failures
                }
              }
            }

            // ── Policy-driven success check ──
            const syncWasSuccessful = shouldCountAsSuccess(syncResult);

            if (syncWasSuccessful) {
              const { error: tsError } = await supabase
                .from("work_items")
                .update({ last_synced_at: new Date().toISOString() })
                .eq("id", workItem.id);
              if (tsError) {
                console.error(`[scheduled-daily-sync] CRITICAL: Failed to update last_synced_at for ${workItem.id}: ${tsError.message}`);
              }
            }

            return {
              work_item_id: workItem.id,
              radicado: workItem.radicado,
              actSuccess: syncWasSuccessful,
              scrapingInitiated: isScrapingPending(syncResult),
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

      // === PERSIST CURSOR ===
      const lastItemInBatch = batch[batch.length - 1];
      if (lastItemInBatch) {
        try {
          await (supabase.from('cron_state') as any).upsert({
            key: cursorKey,
            value: { 
              cursor_work_item_id: lastItemInBatch.id,
              updated_at: new Date().toISOString(),
              items_processed_this_run: i + batch.length,
              items_total: sortedItems.length,
            },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
        } catch (cursorSaveErr) {
          console.warn(`[scheduled-daily-sync] Cursor save error:`, cursorSaveErr);
        }
      }
    }

    // ============= GHOST ITEM DETECTION =============
    const processedItemIds = new Set<string>();
    for (let idx = 0; idx < sortedItems.length && idx < (sortedItems.length - itemsSkipped); idx++) {
      processedItemIds.add(sortedItems[idx].id);
    }
    let ghostItems = sortedItems.filter((item: any) => !processedItemIds.has(item.id));
    
    // Exclude items with pending retries from ghost count
    if (ghostItems.length > 0) {
      const ghostIds = ghostItems.map((g: any) => g.id);
      const { data: ghostRetries } = await (supabase.from('sync_retry_queue') as any)
        .select('work_item_id')
        .in('work_item_id', ghostIds);
      if (ghostRetries && ghostRetries.length > 0) {
        const retryGhostIds = new Set(ghostRetries.map((r: any) => r.work_item_id));
        const beforeGhost = ghostItems.length;
        ghostItems = ghostItems.filter((g: any) => !retryGhostIds.has(g.id));
        console.log(`[scheduled-daily-sync] Excluded ${beforeGhost - ghostItems.length} pending-retry items from ghost count`);
      }
    }
    
    if (ghostItems.length > 0) {
      console.log(`[scheduled-daily-sync] ${ghostItems.length} ghost items detected (never processed this run)`);
      
      try {
        const { data: membership } = await supabase
          .from('organization_memberships')
          .select('user_id')
          .eq('organization_id', orgId)
          .eq('role', 'admin')
          .limit(1)
          .maybeSingle();

        if (membership?.user_id && ghostItems.length >= 3) {
          const ghostRadicados = ghostItems.slice(0, 5).map((g: any) => g.radicado || 'sin radicado').join(', ');
          await supabase.from('alert_instances').insert({
            owner_id: membership.user_id,
            organization_id: orgId,
            entity_type: 'SYSTEM',
            entity_id: orgId,
            severity: 'INFO',
            status: 'PENDING',
            title: `${ghostItems.length} procesos no sincronizados hoy`,
            message: `Estos procesos tienen monitoreo activo pero no fueron consultados por tiempo limitado: ${ghostRadicados}${ghostItems.length > 5 ? '...' : ''}. Se priorizarán en la próxima ejecución.`,
            fingerprint: `ghost_items_${orgId}_${new Date().toISOString().slice(0, 10)}`,
            payload: {
              ghost_count: ghostItems.length,
              ghost_ids: ghostItems.slice(0, 20).map((g: any) => g.id),
            },
          });
        }
      } catch (ghostAlertErr) {
        console.warn(`[scheduled-daily-sync] Ghost alert creation error:`, ghostAlertErr);
      }
    }

    // ============= AUTO-DEMONITOR POLICY (via syncPolicy) =============
    let demonitored = 0;
    try {
      const { data: aiConfig } = await supabase
        .from('atenia_ai_config')
        .select('auto_demonitor_after_404s')
        .eq('organization_id', orgId)
        .maybeSingle();
      
      const threshold = aiConfig?.auto_demonitor_after_404s ?? 5;
      
      if (threshold > 0) {
        const { data: candidates } = await supabase
          .from('work_items')
          .select('id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at, monitoring_enabled')
          .eq('organization_id', orgId)
          .eq('monitoring_enabled', true)
          .gte('consecutive_404_count', threshold);
        
        if (candidates && candidates.length > 0) {
          // Check which candidates have pending retries
          const candidateIds = candidates.map((c: any) => c.id);
          const { data: pendingRetries } = await (supabase.from('sync_retry_queue') as any)
            .select('work_item_id')
            .in('work_item_id', candidateIds);
          const retryingIds = new Set((pendingRetries || []).map((r: any) => r.work_item_id));

          // Apply policy-driven demonitor decision
          const chronic404s = candidates.filter((item: any) => {
            const decision = shouldDemonitor(item, threshold, retryingIds.has(item.id));
            if (!decision.demonitor) {
              console.log(`[scheduled-daily-sync] Demonitor skip ${item.radicado}: ${decision.reason}`);
            }
            return decision.demonitor;
          });

          if (chronic404s.length > 0) {
            console.log(`[scheduled-daily-sync] Auto-demonitor: ${chronic404s.length} items (of ${candidates.length} candidates) pass all safety gates`);
            
            const demonitorIds = chronic404s.map((item: any) => item.id);
            const now = new Date().toISOString();
            
            await supabase
              .from('work_items')
              .update({
                monitoring_enabled: false,
                demonitor_reason: `Auto-demonitored: ${threshold}+ consecutive 404 errors, stale >${DEFAULT_STALENESS_GUARD_DAYS}d`,
                demonitor_at: now,
              })
              .in('id', demonitorIds);
            
            demonitored = chronic404s.length;
            
            // Audit trail via atenia_ai_actions
            for (const item of chronic404s.slice(0, 10)) {
              try {
                await supabase.from('atenia_ai_actions').insert({
                  organization_id: orgId,
                  action_type: 'AUTO_DEMONITOR',
                  autonomy_tier: 'ACT',
                  reasoning: `Radicado ${item.radicado || 'desconocido'} tuvo ${item.consecutive_404_count} errores 404 consecutivos (umbral: ${threshold}), sin éxito reciente. Monitoreo suspendido automáticamente.`,
                  target_entity_type: 'WORK_ITEM',
                  target_entity_id: item.id,
                  action_taken: 'monitoring_disabled',
                  action_result: 'SUCCESS',
                  evidence: buildAuditEvidence({
                    item,
                    retryRowPresent: false,
                    threshold,
                  }),
                });
              } catch {
                // Non-blocking
              }
            }
            
            // Summary alert
            const { data: membership } = await supabase
              .from('organization_memberships')
              .select('user_id')
              .eq('organization_id', orgId)
              .eq('role', 'admin')
              .limit(1)
              .maybeSingle();

            if (membership?.user_id) {
              const demonitoredRadicados = chronic404s.slice(0, 5).map((i: any) => i.radicado || 'N/A').join(', ');
              await supabase.from('alert_instances').insert({
                owner_id: membership.user_id,
                organization_id: orgId,
                entity_type: 'SYSTEM',
                entity_id: orgId,
                severity: 'WARNING',
                status: 'PENDING',
                title: `${chronic404s.length} proceso(s) suspendido(s) automáticamente`,
                message: `Se suspendió el monitoreo de ${chronic404s.length} proceso(s) con ${threshold}+ errores 404 consecutivos y sin éxito en ${DEFAULT_STALENESS_GUARD_DAYS}+ días: ${demonitoredRadicados}${chronic404s.length > 5 ? '...' : ''}. Puede reactivarlos manualmente desde el detalle del proceso.`,
                fingerprint: `auto_demonitor_${orgId}_${new Date().toISOString().slice(0, 10)}`,
                payload: {
                  demonitored_count: chronic404s.length,
                  demonitored_ids: demonitorIds.slice(0, 20),
                  threshold,
                  staleness_guard_days: DEFAULT_STALENESS_GUARD_DAYS,
                },
              });
            }
          } else {
            console.log(`[scheduled-daily-sync] Auto-demonitor: ${candidates.length} candidates but all blocked by safety gates`);
          }
        }
      }
    } catch (demonitorErr) {
      console.warn(`[scheduled-daily-sync] Auto-demonitor error:`, demonitorErr);
    }

    // Determine final status
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

    await supabase.rpc('update_daily_sync_ledger', {
      p_ledger_id: ledgerId,
      p_status: finalStatus,
      p_items_succeeded: successCount + scrapingInitiated,
      p_items_failed: errorCount,
      p_metadata: {
        publicaciones_synced: publicacionesSynced,
        scraping_initiated: scrapingInitiated,
        items_skipped: itemsSkipped,
        ghost_items: ghostItems.length,
        demonitored,
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
