import { createClient } from "npm:@supabase/supabase-js@2";
import { createTraceContext, writeTraceRecord } from "../_shared/traceContext.ts";
import {
  shouldCountAsSuccess,
  shouldRunPublicaciones,
  isScrapingPending,
  shouldEnqueueRetry,
  retryJitterMs,
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
  PUBLICACIONES_WORKFLOWS,
} from "../_shared/syncPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "fallback-sync-check" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch { /* not JSON, proceed normally */ }

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

    // ── Overflow pass: pick up chains that exhausted budget and scheduled overflow ──
    let overflowTriggered = 0;
    try {
      const { data: overflowRows } = await supabase
        .from("auto_sync_daily_ledger")
        .select("id, organization_id, chain_id, metadata, cursor_last_work_item_id, run_cutoff_time, trigger_source, manual_initiator_user_id")
        .eq("run_date", todayStr)
        .eq("continuation_block_reason", "OVERFLOW_SCHEDULED")
        .limit(10);

      for (const row of (overflowRows || [])) {
        const meta = (row.metadata || {}) as Record<string, any>;
        const overflowRunAt = meta.overflow_run_at;
        // Only fire if the scheduled time has passed
        if (overflowRunAt && new Date(overflowRunAt) > new Date()) {
          console.log(`[fallback-sync-check] Overflow for chain ${row.chain_id} not due until ${overflowRunAt}`);
          continue;
        }

        console.log(`[fallback-sync-check] Triggering overflow pass for chain ${row.chain_id}, org=${row.organization_id}`);
        try {
          await supabase.functions.invoke("scheduled-daily-sync", {
            body: {
              org_id: row.organization_id,
              resume_after_id: meta.overflow_resume_after_id || row.cursor_last_work_item_id,
              is_continuation: true,
              continuation_of: row.id,
              continuation_count: 0,
              run_cutoff_time: row.run_cutoff_time,
              chain_id: row.chain_id,
              trigger_source: row.trigger_source || "OVERFLOW",
              manual_initiator_user_id: row.manual_initiator_user_id,
              is_overflow: true,
              item_timeout_counts: meta.overflow_item_timeout_counts || {},
            },
          });
          // Mark overflow as consumed so it doesn't fire again
          await supabase.from("auto_sync_daily_ledger")
            .update({ continuation_block_reason: "OVERFLOW_DISPATCHED" })
            .eq("id", row.id);
          overflowTriggered++;
        } catch (overflowErr: any) {
          console.warn(`[fallback-sync-check] Overflow trigger failed for chain ${row.chain_id}:`, overflowErr.message);
        }
      }
    } catch (overflowCheckErr) {
      console.warn(`[fallback-sync-check] Overflow check error:`, overflowCheckErr);
    }

    if (overflowTriggered > 0) {
      console.log(`[fallback-sync-check] Triggered ${overflowTriggered} overflow pass(es)`);
    }

    // If no pending orgs, also check for orgs with no ledger entry today (missed entirely)
    if (pendingList.length === 0 && overflowTriggered === 0) {
      const missedOrgs = await findMissedOrganizations(supabase, todayStr);
      if (missedOrgs.length > 0) {
        console.log(`[fallback-sync-check] Found ${missedOrgs.length} orgs with no sync today`);
        
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
            overflow_triggered: overflowTriggered,
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
          overflow_triggered: overflowTriggered,
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
      if (Date.now() - startTime > 50000) {
        console.log("[fallback-sync-check] Approaching timeout, stopping retries");
        break;
      }

      if (pendingOrg.retry_count > 0) {
        const backoffMs = Math.min(pendingOrg.retry_count * 2000, 10000);
        console.log(`[fallback-sync-check] Backoff ${backoffMs}ms for org ${pendingOrg.organization_id}`);
        await new Promise(r => setTimeout(r, backoffMs));
      }

      try {
        console.log(`[fallback-sync-check] Retrying org ${pendingOrg.organization_id} (attempt ${pendingOrg.retry_count + 1})`);
        retriesAttempted++;

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
          .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
          .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
          .not("radicado", "is", null)
          .or(`last_synced_at.is.null,last_synced_at.lt.${ledgerStartedAt}`)
          .limit(30);

        if (fetchError) {
          throw fetchError;
        }

        const eligibleItems = (workItems || []).filter((item: any) => {
          if (!item.radicado || item.radicado.replace(/\D/g, '').length !== 23) return false;
          if ((item.consecutive_failures || 0) >= 3) {
            console.log(`[fallback-sync-check] Skipping ${item.radicado}: ${item.consecutive_failures} consecutive failures`);
            return false;
          }
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

            // ── Policy-driven success/pending/failure classification ──
            if (shouldCountAsSuccess(syncResult)) {
              // True success: trigger pub sync via policy gate, update timestamp
              if (shouldRunPublicaciones(syncResult) &&
                  (PUBLICACIONES_WORKFLOWS as readonly string[]).includes(item.workflow_type)) {
                try {
                  await supabase.functions.invoke("sync-publicaciones-by-work-item", {
                    body: { work_item_id: item.id, _scheduled: true }
                  });
                } catch {
                  // Non-blocking
                }
              }

              await supabase
                .from("work_items")
                .update({ last_synced_at: new Date().toISOString() })
                .eq("id", item.id);
              syncedCount++;
            } else if (isScrapingPending(syncResult)) {
              // Scraping in progress — do NOT mark as success, do NOT clear failure counters.
              // Use policy engine to decide retry enqueue.
              console.log(`[fallback-sync-check] ${item.radicado}: scraping pending, checking retry enqueue`);
              try {
                const { data: existingRetry } = await (supabase.from('sync_retry_queue') as any)
                  .select('id, work_item_id, kind, attempt, max_attempts')
                  .eq('work_item_id', item.id)
                  .eq('kind', 'ACT_SCRAPE_RETRY')
                  .maybeSingle();

                const decision = shouldEnqueueRetry(syncResult, existingRetry);
                if (decision.enqueue) {
                  const nextRunAt = new Date(Date.now() + retryJitterMs()).toISOString();
                  await (supabase.from('sync_retry_queue') as any).insert({
                    work_item_id: item.id,
                    organization_id: pendingOrg.organization_id,
                    radicado: item.radicado,
                    workflow_type: item.workflow_type,
                    kind: decision.kind,
                    provider: syncResult?.scraping_provider || 'cpnu',
                    attempt: 1,
                    max_attempts: 3,
                    next_run_at: nextRunAt,
                    last_error_code: 'SCRAPING_TIMEOUT',
                    last_error_message: 'Enqueued by fallback-sync-check',
                    scraping_job_id: syncResult?.scraping_job_id || null,
                  });
                  console.log(`[fallback-sync-check] Retry enqueued for ${item.radicado}: ${decision.reason}`);
                }
              } catch (retryEnqueueErr) {
                console.warn(`[fallback-sync-check] Failed to enqueue retry:`, retryEnqueueErr);
              }
              // Count as "pending" — not success, not error
            } else {
              errorCount++;
            }
          } catch {
            errorCount++;
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 1200));

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

    // Write trace record
    const trace = createTraceContext("fallback-sync-check", "CRON", { cron_run_id: runId });
    const traceStatus = retriesSucceeded === retriesAttempted ? "OK" as const : retriesSucceeded > 0 ? "PARTIAL" as const : retriesAttempted > 0 ? "ERROR" as const : "OK" as const;
    try {
      await writeTraceRecord(supabase, trace, traceStatus, {
        work_items_scanned: retriesAttempted,
        queue_stats: {
          processed: retriesAttempted,
          succeeded: retriesSucceeded,
          failed: retriesAttempted - retriesSucceeded,
        },
        errors: retryResults.filter(r => r.error).length > 0
          ? [{ code: "FALLBACK_RETRY_ERR", message: retryResults.filter(r => r.error).slice(0, 3).map(r => r.error).join("; "), count: retryResults.filter(r => r.error).length }]
          : undefined,
        overflow_triggered: overflowTriggered,
      }, new Date(startTime));
    } catch (_traceErr) { /* non-blocking */ }

    return new Response(
      JSON.stringify({
        ok: true,
        action: "RETRIES_EXECUTED",
        retries_attempted: retriesAttempted,
        retries_succeeded: retriesSucceeded,
        results: retryResults,
        overflow_triggered: overflowTriggered,
        cron_run_id: trace.cron_run_id,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("[fallback-sync-check] Fatal error:", err);
    // Write error trace
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseServiceKey) {
        const sb = createClient(supabaseUrl, supabaseServiceKey);
        const trace = createTraceContext("fallback-sync-check", "CRON", { cron_run_id: runId });
        await writeTraceRecord(sb, trace, "ERROR", {
          errors: [{ code: "FATAL", message: err.message || String(err), count: 1 }],
        }, new Date(startTime));
      }
    } catch (_te) { /* best-effort */ }
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
  const { data: orgsWithItems } = await supabase
    .from("work_items")
    .select("organization_id")
    .eq("monitoring_enabled", true)
    .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
    .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
    .not("radicado", "is", null)
    .not("organization_id", "is", null);

  const rawOrgIds = (orgsWithItems || [])
    .map((i: { organization_id: string | null }) => i.organization_id)
    .filter((id: string | null): id is string => id !== null);
  
  const allOrgIds: string[] = [...new Set(rawOrgIds)] as string[];

  if (allOrgIds.length === 0) return [];

  const { data: ledgerEntries } = await supabase
    .from("auto_sync_daily_ledger")
    .select("organization_id")
    .eq("run_date", todayStr);

  const orgsWithLedger = new Set(
    (ledgerEntries || []).map((e: { organization_id: string }) => e.organization_id)
  );

  return allOrgIds.filter((orgId) => !orgsWithLedger.has(orgId));
}
