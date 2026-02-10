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

// Retry schedule (hours after 07:00 COT when to retry)
const RETRY_HOURS = [2, 4, 7, 10, 13]; // 09:00, 11:00, 14:00, 17:00, 20:00 COT

// Max retries per org per day
const MAX_RETRIES = 5;

// Cutoff hour (COT) after which we stop retrying
const CUTOFF_HOUR = 20;

/**
 * Fallback sync check - runs every 2-4 hours
 * Catches any missed syncs from the daily job and retries failed orgs
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[fallback-sync-check] Starting fallback check (run_id: ${runId})`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current time in Colombia
    const nowCOT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const currentHour = nowCOT.getHours();
    const todayStr = nowCOT.toISOString().split('T')[0];

    console.log(`[fallback-sync-check] COT time: ${nowCOT.toISOString()}, hour: ${currentHour}`);

    // Check if we're past cutoff
    if (currentHour >= CUTOFF_HOUR) {
      console.log("[fallback-sync-check] Past cutoff hour, no retries allowed");
      return new Response(
        JSON.stringify({
          ok: true,
          action: "PAST_CUTOFF",
          message: `Past ${CUTOFF_HOUR}:00 COT cutoff, no more retries today`,
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get orgs that need retry from the daily ledger
    const { data: pendingOrgs, error: pendingError } = await supabase.rpc('get_pending_daily_syncs', {
      p_max_retries: MAX_RETRIES,
      p_cutoff_hour: CUTOFF_HOUR
    });

    if (pendingError) {
      console.error("[fallback-sync-check] Error getting pending syncs:", pendingError);
      throw pendingError;
    }

    const pendingList = (pendingOrgs || []) as Array<{
      organization_id: string;
      ledger_id: string;
      status: string;
      retry_count: number;
      last_error: string | null;
    }>;

    console.log(`[fallback-sync-check] Found ${pendingList.length} orgs needing retry`);

    // If no pending orgs, also check for orgs with no ledger entry today (missed entirely)
    if (pendingList.length === 0) {
      const missedOrgs = await findMissedOrganizations(supabase, todayStr);
      if (missedOrgs.length > 0) {
        console.log(`[fallback-sync-check] Found ${missedOrgs.length} orgs with no sync today`);
        
        // Trigger full sync for missed orgs by invoking scheduled-daily-sync
        const { data, error } = await supabase.functions.invoke("scheduled-daily-sync");

        if (error) {
          console.error("[fallback-sync-check] Failed to trigger catchup sync:", error);
          return new Response(
            JSON.stringify({
              ok: false,
              action: "CATCHUP_TRIGGER_FAILED",
              error: error.message,
              missed_orgs: missedOrgs.length,
              duration_ms: Date.now() - startTime,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            ok: true,
            action: "CATCHUP_TRIGGERED",
            missed_orgs: missedOrgs.length,
            sync_results: data,
            duration_ms: Date.now() - startTime,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          action: "NO_ACTION_NEEDED",
          message: "All orgs have successful syncs today",
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retry failed/partial orgs
    const retryResults: Array<{ org_id: string; status: string; error?: string }> = [];
    let retriesAttempted = 0;
    let retriesSucceeded = 0;

    for (const pendingOrg of pendingList) {
      // Check for timeout
      if (Date.now() - startTime > 50000) {
        console.log("[fallback-sync-check] Approaching timeout, stopping retries");
        break;
      }

      // Apply backoff based on retry count
      if (pendingOrg.retry_count > 0) {
        const backoffMs = Math.min(pendingOrg.retry_count * 2000, 10000);
        console.log(`[fallback-sync-check] Backoff ${backoffMs}ms for org ${pendingOrg.organization_id}`);
        await new Promise(r => setTimeout(r, backoffMs));
      }

      try {
        console.log(`[fallback-sync-check] Retrying org ${pendingOrg.organization_id} (attempt ${pendingOrg.retry_count + 1})`);
        retriesAttempted++;

        // Get work items for this org
        // Only retry items that weren't reached in the original run
        // Skip items with high consecutive_failures (at-risk, let daily cron handle with priority)
        // Skip items already auto-demonitored
        const { data: ledgerEntry } = await supabase
          .from("auto_sync_daily_ledger")
          .select("started_at")
          .eq("id", pendingOrg.ledger_id)
          .single();

        const ledgerStartedAt = ledgerEntry?.started_at || new Date(new Date().setHours(0,0,0,0)).toISOString();

        const { data: workItems, error: fetchError } = await supabase
          .from("work_items")
          .select("id, radicado, workflow_type, consecutive_failures, consecutive_404_count, last_error_code")
          .eq("organization_id", pendingOrg.organization_id)
          .eq("monitoring_enabled", true)
          .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
          .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
          .not("radicado", "is", null)
          .or(`last_synced_at.is.null,last_synced_at.lt.${ledgerStartedAt}`)
          .limit(30);

        if (fetchError) {
          throw fetchError;
        }

        // Filter: valid radicados + skip chronic failures + skip rate-limited items
        const eligibleItems = (workItems || []).filter((item: any) => {
          if (!item.radicado || item.radicado.replace(/\D/g, '').length !== 23) return false;
          // Skip items with 3+ consecutive failures (let daily cron prioritize them)
          if ((item.consecutive_failures || 0) >= 3) {
            console.log(`[fallback-sync-check] Skipping ${item.radicado}: ${item.consecutive_failures} consecutive failures`);
            return false;
          }
          // Skip items whose last error was rate limiting (don't hammer the provider)
          if (item.last_error_code === 'PROVIDER_RATE_LIMITED') {
            console.log(`[fallback-sync-check] Skipping ${item.radicado}: rate limited`);
            return false;
          }
          return true;
        });

        console.log(`[fallback-sync-check] Org ${pendingOrg.organization_id}: ${eligibleItems.length} eligible items (of ${(workItems || []).length} total)`);

        let syncedCount = 0;
        let errorCount = 0;

        for (const item of eligibleItems) {
          try {
            const { data: syncResult } = await supabase.functions.invoke("sync-by-work-item", {
              body: { work_item_id: item.id, _scheduled: true }
            });

            const syncOk = syncResult?.ok === true || syncResult?.scraping_initiated === true;

            // Publicaciones (skip for items with recent errors)
            if (syncOk && ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'].includes(item.workflow_type)) {
              try {
                await supabase.functions.invoke("sync-publicaciones-by-work-item", {
                  body: { work_item_id: item.id, _scheduled: true }
                });
              } catch {
                // Non-blocking
              }
            }

            if (syncOk) {
              await supabase
                .from("work_items")
                .update({ last_synced_at: new Date().toISOString() })
                .eq("id", item.id);
              syncedCount++;
            } else {
              errorCount++;
            }
          } catch {
            errorCount++;
          }

          // Rate limit — longer delay between items to avoid provider rate limiting
          await new Promise(r => setTimeout(r, 1200));

          // Timeout check
          if (Date.now() - startTime > 48000) break;
        }

        // Update ledger
        const successRate = eligibleItems.length > 0 ? syncedCount / eligibleItems.length : 1;
        const newStatus = successRate >= 0.9 ? 'SUCCESS' : (syncedCount > 0 ? 'PARTIAL' : 'FAILED');

        await supabase.rpc('update_daily_sync_ledger', {
          p_ledger_id: pendingOrg.ledger_id,
          p_status: newStatus,
          p_items_succeeded: syncedCount,
          p_items_failed: errorCount,
          p_metadata: { retry_run_id: runId, retry_at: new Date().toISOString() }
        });

        if (newStatus === 'SUCCESS') {
          retriesSucceeded++;
        }

        retryResults.push({
          org_id: pendingOrg.organization_id,
          status: newStatus
        });

      } catch (retryError: any) {
        console.error(`[fallback-sync-check] Retry failed for org ${pendingOrg.organization_id}:`, retryError);
        
        await supabase.rpc('update_daily_sync_ledger', {
          p_ledger_id: pendingOrg.ledger_id,
          p_status: 'FAILED',
          p_error: retryError.message || String(retryError)
        });

        retryResults.push({
          org_id: pendingOrg.organization_id,
          status: 'FAILED',
          error: retryError.message
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "RETRIES_EXECUTED",
        retries_attempted: retriesAttempted,
        retries_succeeded: retriesSucceeded,
        results: retryResults,
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

/**
 * Find organizations that have eligible work items but no ledger entry for today
 */
async function findMissedOrganizations(
  supabase: any,
  todayStr: string
): Promise<string[]> {
  // Get orgs with eligible items
  const { data: orgsWithItems } = await supabase
    .from("work_items")
    .select("organization_id")
    .eq("monitoring_enabled", true)
    .in("workflow_type", SYNC_ENABLED_WORKFLOWS)
    .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
    .not("radicado", "is", null)
    .not("organization_id", "is", null);


  const rawOrgIds = (orgsWithItems || [])
    .map((i: { organization_id: string | null }) => i.organization_id)
    .filter((id: string | null): id is string => id !== null);
  
  const allOrgIds: string[] = [...new Set(rawOrgIds)] as string[];

  if (allOrgIds.length === 0) return [];

  // Get orgs with ledger entries today
  const { data: ledgerEntries } = await supabase
    .from("auto_sync_daily_ledger")
    .select("organization_id")
    .eq("run_date", todayStr);

  const orgsWithLedger = new Set(
    (ledgerEntries || []).map((e: { organization_id: string }) => e.organization_id)
  );

  // Return orgs without ledger entry
  return allOrgIds.filter((orgId) => !orgsWithLedger.has(orgId));
}
