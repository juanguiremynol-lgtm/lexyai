import { createClient } from "npm:@supabase/supabase-js@2";
import {
  shouldCountAsSuccess,
  shouldRunPublicaciones,
  isScrapingPending,
  shouldDemonitor,
  buildAuditEvidence,
  PUBLICACIONES_WORKFLOWS,
  DEFAULT_STALENESS_GUARD_DAYS,
} from "../_shared/syncPolicy.ts";
import {
  selectEligibleWorkItems,
  type EligibleWorkItem,
} from "../_shared/sync-eligibility.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Hard budget: 140s of the ~150s edge function limit */
const HARD_BUDGET_MS = 140_000;
/** Items per cursor page */
const PAGE_SIZE = 5;
/** Success threshold for OK vs PARTIAL */
const SUCCESS_THRESHOLD = 0.9;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  console.log(`[daily-sync] START run_id=${runId}`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all orgs with eligible items
    const { data: orgRows, error: orgErr } = await supabase
      .from("work_items")
      .select("organization_id")
      .eq("monitoring_enabled", true)
      .not("radicado", "is", null)
      .not("organization_id", "is", null);
    if (orgErr) throw orgErr;

    const orgIds = [...new Set((orgRows || []).map((r: any) => r.organization_id).filter(Boolean))];
    console.log(`[daily-sync] ${orgIds.length} org(s) with eligible items`);

    const allResults: Array<{ org_id: string; status: string; synced: number; errors: number; ledger_id?: string }> = [];

    for (const orgId of orgIds) {
      if (Date.now() - startTime > HARD_BUDGET_MS) {
        console.warn(`[daily-sync] Global budget exhausted before org ${orgId}`);
        break;
      }
      try {
        const result = await syncOrganization(supabase, supabaseUrl, supabaseServiceKey, orgId, runId, startTime);
        allResults.push(result);
      } catch (orgError: any) {
        console.error(`[daily-sync] Org ${orgId} fatal:`, orgError.message);
        allResults.push({ org_id: orgId, status: "FAILED", synced: 0, errors: 1 });
      }
    }

    const durationMs = Date.now() - startTime;
    const totalSynced = allResults.reduce((s, r) => s + r.synced, 0);
    const totalErrors = allResults.reduce((s, r) => s + r.errors, 0);

    // Legacy job_runs log
    try {
      await supabase.from("job_runs").insert({
        job_name: "scheduled-daily-sync",
        status: totalErrors === 0 ? "OK" : "PARTIAL",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: totalSynced,
        metadata: { run_id: runId, results: allResults.slice(0, 20) },
      });
    } catch { /* non-blocking */ }

    // Fire-and-forget Atenia AI post-sync
    supabase.functions.invoke("atenia-ai-supervisor", {
      body: { mode: "POST_DAILY_SYNC" },
    }).catch(() => {});

    return new Response(
      JSON.stringify({ ok: true, run_id: runId, duration_ms: durationMs, orgs: allResults }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[daily-sync] Fatal:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message, run_id: runId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ─── Per-org sync with cursor pagination, error isolation, budget tracking ───

async function syncOrganization(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  orgId: string,
  runId: string,
  globalStart: number,
): Promise<{ org_id: string; status: string; synced: number; errors: number; ledger_id?: string }> {
  console.log(`[daily-sync] org=${orgId} starting`);

  // Acquire lock via ledger
  const { data: lockResult, error: lockError } = await supabase.rpc("acquire_daily_sync_lock", {
    p_organization_id: orgId,
    p_run_id: runId,
  });
  if (lockError) throw lockError;

  const lock = lockResult as { acquired: boolean; ledger_id: string; status: string; reason?: string };
  if (!lock.acquired) {
    console.log(`[daily-sync] org=${orgId} skip: ${lock.reason}`);
    return { org_id: orgId, status: lock.status, synced: 0, errors: 0, ledger_id: lock.ledger_id };
  }

  const ledgerId = lock.ledger_id;
  let itemsSucceeded = 0;
  let itemsFailed = 0;
  let itemsSkipped = 0;
  let cursorLastId: string | null = null;
  let failureReason: string | null = null;
  const errorSummary: Array<{ work_item_id: string; radicado?: string; error: string; ts: string }> = [];

  try {
    // Count total eligible items (single query, no limit)
    const allItems = await selectEligibleWorkItems(supabase, orgId);
    const expectedTotal = allItems.length;

    console.log(`[daily-sync] org=${orgId} eligible=${expectedTotal}`);

    // Write ledger RUNNING with expected_total
    await updateLedger(supabase, ledgerId, {
      status: "RUNNING",
      items_targeted: expectedTotal,
      expected_total_items: expectedTotal,
    });

    // Cursor-driven pagination through items, ordered by id ASC
    let cursor: string | undefined = undefined;
    let pageItems: EligibleWorkItem[];
    let processedCount = 0;

    do {
      // Budget check BEFORE fetching next page
      if (Date.now() - globalStart > HARD_BUDGET_MS) {
        failureReason = "BUDGET_EXHAUSTED";
        itemsSkipped = expectedTotal - processedCount;
        console.warn(`[daily-sync] org=${orgId} budget exhausted at ${processedCount}/${expectedTotal}`);
        break;
      }

      pageItems = await selectEligibleWorkItems(supabase, orgId, {
        afterId: cursor,
        limit: PAGE_SIZE,
      });

      if (pageItems.length === 0) break;

      // Process each item with error isolation
      for (const item of pageItems) {
        // Per-item budget check
        if (Date.now() - globalStart > HARD_BUDGET_MS) {
          failureReason = "BUDGET_EXHAUSTED";
          itemsSkipped += (pageItems.length - pageItems.indexOf(item));
          break;
        }

        try {
          await syncSingleItem(supabase, item, orgId);
          itemsSucceeded++;
        } catch (err: any) {
          itemsFailed++;
          errorSummary.push({
            work_item_id: item.id,
            radicado: item.radicado,
            error: (err.message || String(err)).substring(0, 200),
            ts: new Date().toISOString(),
          });
          // CONTINUE — never abort on single item failure
        }

        cursorLastId = item.id;
        processedCount++;
      }

      cursor = pageItems[pageItems.length - 1]?.id;

      // Progress heartbeat to ledger after each page
      await updateLedger(supabase, ledgerId, {
        status: "RUNNING",
        items_succeeded: itemsSucceeded,
        items_failed: itemsFailed,
        items_skipped: itemsSkipped,
        cursor_last_work_item_id: cursorLastId,
        error_summary: errorSummary.slice(0, 50), // cap stored errors
      });
    } while (pageItems.length === PAGE_SIZE && !failureReason);

    // If budget wasn't exhausted, account for remaining skipped
    if (!failureReason) {
      itemsSkipped = expectedTotal - (itemsSucceeded + itemsFailed);
      if (itemsSkipped < 0) itemsSkipped = 0;
    }

    // Determine final status
    const totalAttempted = itemsSucceeded + itemsFailed;
    let finalStatus: string;
    if (itemsFailed === 0 && totalAttempted >= expectedTotal) {
      finalStatus = "SUCCESS";
    } else if (itemsSucceeded > 0 && totalAttempted > 0) {
      const successRate = itemsSucceeded / totalAttempted;
      finalStatus = successRate >= SUCCESS_THRESHOLD ? "SUCCESS" : "PARTIAL";
    } else if (itemsSucceeded === 0 && totalAttempted > 0) {
      finalStatus = "FAILED";
    } else if (expectedTotal === 0) {
      finalStatus = "SUCCESS"; // No items to sync
    } else {
      finalStatus = "FAILED";
    }

    if (failureReason) {
      finalStatus = itemsSucceeded > 0 ? "PARTIAL" : "FAILED";
    }

    // Final ledger update
    await updateLedger(supabase, ledgerId, {
      status: finalStatus,
      items_succeeded: itemsSucceeded,
      items_failed: itemsFailed,
      items_skipped: itemsSkipped,
      cursor_last_work_item_id: cursorLastId,
      failure_reason: failureReason,
      error_summary: errorSummary.slice(0, 50),
      finished_at: new Date().toISOString(),
      expected_total_items: expectedTotal,
      metadata: {
        run_id: runId,
        duration_ms: Date.now() - globalStart,
        page_size: PAGE_SIZE,
        budget_ms: HARD_BUDGET_MS,
      },
    });

    // Auto-demonitor policy (from existing logic, condensed)
    await runAutoDemonitor(supabase, orgId);

    console.log(`[daily-sync] org=${orgId} done: ${finalStatus} ${itemsSucceeded}✅ ${itemsFailed}❌ ${itemsSkipped}⏭️ / ${expectedTotal}`);
    return { org_id: orgId, status: finalStatus, synced: itemsSucceeded, errors: itemsFailed, ledger_id: ledgerId };

  } catch (error: any) {
    // Fatal org-level error
    await updateLedger(supabase, ledgerId, {
      status: "FAILED",
      items_succeeded: itemsSucceeded,
      items_failed: itemsFailed,
      failure_reason: error.message?.substring(0, 500),
      error_summary: errorSummary.slice(0, 50),
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

// ─── Sync a single work item (acts + pubs) ───

async function syncSingleItem(supabase: any, item: EligibleWorkItem, orgId: string): Promise<void> {
  // Sync actuaciones
  const { data: syncResult, error: syncError } = await supabase.functions.invoke(
    "sync-by-work-item",
    { body: { work_item_id: item.id, _scheduled: true } },
  );
  if (syncError) throw syncError;

  const syncOk = shouldCountAsSuccess(syncResult);

  // Update last_synced_at only on true success
  if (syncOk) {
    await supabase
      .from("work_items")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", item.id);
  }

  // Sync publicaciones if act sync succeeded and workflow supports it
  if (
    syncOk &&
    shouldRunPublicaciones(syncResult) &&
    (PUBLICACIONES_WORKFLOWS as readonly string[]).includes(item.workflow_type)
  ) {
    // For PENAL_906 heavy cases, enqueue instead of inline
    if (item.workflow_type === "PENAL_906") {
      try {
        await (supabase.from("sync_retry_queue") as any).upsert(
          {
            work_item_id: item.id,
            organization_id: orgId,
            radicado: item.radicado,
            workflow_type: item.workflow_type,
            stage: item.stage || null,
            kind: "PUB_RETRY",
            provider: "publicaciones",
            attempt: 1,
            max_attempts: 3,
            next_run_at: new Date(Date.now() + 10_000).toISOString(),
            last_error_message: "Enqueued by daily-sync for isolated execution",
          },
          { onConflict: "work_item_id,kind" },
        );
      } catch { /* non-blocking */ }
    } else {
      // Heavy item delay
      if ((item.total_actuaciones || 0) >= 100) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      try {
        await supabase.functions.invoke("sync-publicaciones-by-work-item", {
          body: { work_item_id: item.id, _scheduled: true },
        });
      } catch {
        // Pub errors don't count as item failure
      }
    }
  }

  // If sync wasn't successful and wasn't scraping_pending, this is a soft failure
  // but we still count it as processed (the item was attempted)
  if (!syncOk && !isScrapingPending(syncResult)) {
    // Item returned a provider error but didn't throw — still counts as attempted
    // Don't throw here; the caller already counted it as success if we reach this point
    // Actually we need to signal failure if sync wasn't ok
    if (syncResult?.ok === false) {
      throw new Error(syncResult?.message || syncResult?.code || "sync returned ok=false");
    }
  }
}

// ─── Ledger update helper ───

async function updateLedger(supabase: any, ledgerId: string, fields: Record<string, any>): Promise<void> {
  try {
    // Use direct table update instead of RPC for new columns
    const updatePayload: Record<string, any> = {
      updated_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    };

    if (fields.status) updatePayload.status = fields.status;
    if (fields.items_succeeded !== undefined) updatePayload.items_succeeded = fields.items_succeeded;
    if (fields.items_failed !== undefined) updatePayload.items_failed = fields.items_failed;
    if (fields.items_targeted !== undefined) updatePayload.items_targeted = fields.items_targeted;
    if (fields.items_skipped !== undefined) updatePayload.items_skipped = fields.items_skipped;
    if (fields.expected_total_items !== undefined) updatePayload.expected_total_items = fields.expected_total_items;
    if (fields.cursor_last_work_item_id !== undefined) updatePayload.cursor_last_work_item_id = fields.cursor_last_work_item_id;
    if (fields.failure_reason !== undefined) updatePayload.failure_reason = fields.failure_reason;
    if (fields.error_summary !== undefined) updatePayload.error_summary = fields.error_summary;
    if (fields.finished_at) updatePayload.finished_at = fields.finished_at;
    if (fields.metadata) updatePayload.metadata = fields.metadata;

    if (fields.status === "RUNNING" && !updatePayload.started_at) {
      updatePayload.started_at = new Date().toISOString();
    }
    if (fields.status && fields.status !== "RUNNING" && fields.status !== "PENDING") {
      updatePayload.completed_at = new Date().toISOString();
    }

    await supabase.from("auto_sync_daily_ledger").update(updatePayload).eq("id", ledgerId);
  } catch (err) {
    console.warn(`[daily-sync] Ledger update error:`, err);
  }
}

// ─── Auto-demonitor (condensed from original) ───

async function runAutoDemonitor(supabase: any, orgId: string): Promise<void> {
  try {
    const { data: aiConfig } = await supabase
      .from("atenia_ai_config")
      .select("auto_demonitor_after_404s")
      .eq("organization_id", orgId)
      .maybeSingle();

    const threshold = aiConfig?.auto_demonitor_after_404s ?? 5;
    if (threshold <= 0) return;

    const { data: candidates } = await supabase
      .from("work_items")
      .select("id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at, monitoring_enabled")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .gte("consecutive_404_count", threshold);

    if (!candidates || candidates.length === 0) return;

    const candidateIds = candidates.map((c: any) => c.id);
    const { data: pendingRetries } = await (supabase.from("sync_retry_queue") as any)
      .select("work_item_id")
      .in("work_item_id", candidateIds);
    const retryingIds = new Set((pendingRetries || []).map((r: any) => r.work_item_id));

    const toDemonitor = candidates.filter((item: any) => {
      const decision = shouldDemonitor(item, threshold, retryingIds.has(item.id));
      return decision.demonitor;
    });

    if (toDemonitor.length === 0) return;

    const demonitorIds = toDemonitor.map((i: any) => i.id);
    await supabase
      .from("work_items")
      .update({
        monitoring_enabled: false,
        demonitor_reason: `Auto-demonitored: ${threshold}+ consecutive strict 404 errors`,
        demonitor_at: new Date().toISOString(),
      })
      .in("id", demonitorIds);

    // Audit trail
    for (const item of toDemonitor.slice(0, 10)) {
      try {
        await supabase.from("atenia_ai_actions").insert({
          organization_id: orgId,
          action_type: "AUTO_DEMONITOR",
          autonomy_tier: "ACT",
          reasoning: `Radicado ${item.radicado || "N/A"}: ${item.consecutive_404_count} 404s consecutivos (umbral: ${threshold}).`,
          target_entity_type: "WORK_ITEM",
          target_entity_id: item.id,
          action_taken: "monitoring_disabled",
          action_result: "SUCCESS",
          evidence: buildAuditEvidence({ item, retryRowPresent: false, threshold }),
        });
      } catch { /* non-blocking */ }
    }

    console.log(`[daily-sync] Auto-demonitor: ${toDemonitor.length} items`);
  } catch (err) {
    console.warn("[daily-sync] Auto-demonitor error:", err);
  }
}
