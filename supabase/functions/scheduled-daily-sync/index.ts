import { createClient } from "npm:@supabase/supabase-js@2";
import {
  shouldCountAsSuccess,
  shouldRunPublicaciones,
  isScrapingPending,
  shouldDemonitor,
  buildAuditEvidence,
  enrichDemonitorCandidates,
  PUBLICACIONES_WORKFLOWS,
  DEFAULT_STALENESS_GUARD_DAYS,
} from "../_shared/syncPolicy.ts";
import {
  createTraceContext,
  writeTraceRecord,
  type TraceContext,
  type TraceDetails,
} from "../_shared/traceContext.ts";
import {
  selectEligibleWorkItems,
  type EligibleWorkItem,
} from "../_shared/sync-eligibility.ts";
import {
  startHeartbeat,
  finishHeartbeat,
  type HeartbeatHandle,
} from "../_shared/platformJobHeartbeat.ts";
import {
  MAX_BUSCAR_PER_CRON_CYCLE,
  BUSCAR_CONCURRENCY_LIMIT,
  markNeedsCpnuRefresh,
} from "../_shared/cpnuFreshnessGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Hard budget: wall-clock milliseconds before the function stops processing.
 * Default 140s stays safely below the 150s Free-tier limit.
 */
const HARD_BUDGET_MS = Number(Deno.env.get("DAILY_SYNC_BUDGET_MS") || "140000");
/** Items per cursor page */
const PAGE_SIZE = Number(Deno.env.get("DAILY_SYNC_PAGE_SIZE") || "5");
/** Success threshold for OK vs PARTIAL */
const SUCCESS_THRESHOLD = 0.9;
/** Max chained continuations to prevent infinite loops — raised from 10 to 15 */
const MAX_CONTINUATIONS = Number(Deno.env.get("DAILY_SYNC_MAX_CONTINUATIONS") || "15");
/** Per-item external API timeout (ms). Default 20s. */
const ITEM_TIMEOUT_MS = Number(Deno.env.get("DAILY_SYNC_ITEM_TIMEOUT_MS") || "20000");
/** Consecutive failures before dead-lettering an item */
const DEAD_LETTER_THRESHOLD = 3;
/** Delay before overflow pass (ms) — 30 minutes */
const OVERFLOW_DELAY_MS = 30 * 60 * 1000;
/** Max intra-round retries per item */
const MAX_INTRA_ROUND_RETRIES = 1;
/** Max total API attempts per item per chain (including retries) */
const MAX_ITEM_ATTEMPTS_PER_CHAIN = 3;
/** Timeout backoff delays in ms: [first retry, second retry] */
const TIMEOUT_BACKOFF_MS = [10_000, 30_000];
/** Intra-round retry delay (ms) */
const INTRA_ROUND_RETRY_DELAY_MS = 5_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check short-circuit
  try {
    const cloned = req.clone();
    const maybeBody = await cloned.json().catch(() => null);
    if (maybeBody?.health_check) {
      return new Response(JSON.stringify({ status: "OK", function: "scheduled-daily-sync" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── DRY-RUN MODE: Full verification without writes ──
    if (maybeBody?.dry_run) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !supabaseServiceKey) {
        return new Response(JSON.stringify({ ok: false, error: "Missing Supabase config" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const sb = createClient(supabaseUrl, supabaseServiceKey);
      const dryRunStart = Date.now();

      // 1. Enumerate eligible orgs
      const { data: orgRows, error: orgErr } = await sb
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .not("radicado", "is", null)
        .not("organization_id", "is", null);
      const orgIds = [...new Set((orgRows || []).map((r: any) => r.organization_id).filter(Boolean))];

      // 2. Count eligible items per org with enqueue diagnostics
      const orgSummaries: Array<{
        org_id: string;
        eligible_count: number;
        would_enqueue_count: number;
        sample_radicados: string[];
        exclusion_reasons: Record<string, number>;
      }> = [];
      for (const orgId of orgIds.slice(0, 5)) {
        const { data: allMonitored } = await sb
          .from("work_items")
          .select("id, radicado, workflow_type, stage, last_synced_at, consecutive_failures, monitoring_enabled, scrape_status")
          .eq("organization_id", orgId)
          .eq("monitoring_enabled", true)
          .not("radicado", "is", null)
          .limit(100);

        const exclusions: Record<string, number> = {};
        const eligible: any[] = [];
        for (const item of allMonitored || []) {
          const rad = item.radicado?.replace(/\D/g, '') ?? '';
          if (rad.length !== 23) {
            exclusions["invalid_radicado_format"] = (exclusions["invalid_radicado_format"] || 0) + 1;
            continue;
          }
          if (item.consecutive_failures && item.consecutive_failures >= DEAD_LETTER_THRESHOLD) {
            exclusions["dead_lettered"] = (exclusions["dead_lettered"] || 0) + 1;
            continue;
          }
          if (item.scrape_status === "SCRAPING") {
            exclusions["already_scraping"] = (exclusions["already_scraping"] || 0) + 1;
            continue;
          }
          eligible.push(item);
        }

        orgSummaries.push({
          org_id: orgId,
          eligible_count: (allMonitored || []).length,
          would_enqueue_count: eligible.length,
          sample_radicados: eligible.slice(0, 3).map((i: any) => i.radicado),
          exclusion_reasons: exclusions,
        });
      }

      // 3. Pre-flight check
      let preflightResult: any = null;
      try {
        const { data: pfData } = await sb.functions.invoke("atenia-preflight-check", {
          body: { trigger: "DRY_RUN_VERIFICATION" },
        });
        preflightResult = pfData;
      } catch (pfErr: any) {
        preflightResult = { error: pfErr.message };
      }

      // 4. Check today's ledger
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: ledgerRows } = await (sb.from("auto_sync_daily_ledger") as any)
        .select("id, organization_id, status, items_succeeded, items_failed, items_skipped, chain_id, failure_reason")
        .eq("run_date", todayStr)
        .order("created_at", { ascending: false })
        .limit(10);

      // 5. Check queue depth + retry queue
      const { count: queueDepth } = await (sb.from("atenia_ai_remediation_queue") as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "PENDING");

      const { count: retryQueueDepth } = await (sb.from("sync_retry_queue") as any)
        .select("id", { count: "exact", head: true });

      // 6. Enqueue diagnostics summary
      const totalEligible = orgSummaries.reduce((s, o) => s + o.eligible_count, 0);
      const totalWouldEnqueue = orgSummaries.reduce((s, o) => s + o.would_enqueue_count, 0);
      const aggregatedExclusions: Record<string, number> = {};
      for (const o of orgSummaries) {
        for (const [reason, count] of Object.entries(o.exclusion_reasons)) {
          aggregatedExclusions[reason] = (aggregatedExclusions[reason] || 0) + count;
        }
      }

      // 7. Write DRY_RUN trace
      const trace = createTraceContext("scheduled-daily-sync", "DRY_RUN", { cron_run_id: crypto.randomUUID() });
      await writeTraceRecord(sb, trace, "OK", {
        work_items_scanned: totalEligible,
        queue_stats: { depth_before: queueDepth ?? 0 },
      }, new Date(dryRunStart));

      return new Response(JSON.stringify({
        ok: true,
        mode: "DRY_RUN",
        duration_ms: Date.now() - dryRunStart,
        cron_run_id: trace.cron_run_id,
        orgs_found: orgIds.length,
        org_summaries: orgSummaries,
        preflight: preflightResult,
        today_ledger: ledgerRows ?? [],
        queue_depth: queueDepth ?? 0,
        retry_queue_depth: retryQueueDepth ?? 0,
        enqueue_diagnostics: {
          total_monitored: totalEligible,
          would_enqueue: totalWouldEnqueue,
          excluded: totalEligible - totalWouldEnqueue,
          exclusion_reasons: aggregatedExclusions,
        },
        budget_ms: HARD_BUDGET_MS,
        page_size: PAGE_SIZE,
        max_continuations: MAX_CONTINUATIONS,
        config: {
          item_timeout_ms: ITEM_TIMEOUT_MS,
          dead_letter_threshold: DEAD_LETTER_THRESHOLD,
          success_threshold: SUCCESS_THRESHOLD,
        },
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (_healthErr) { /* not JSON, proceed normally */ }

  const startTime = Date.now();
  const runId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let preflightDecision: string | undefined;

  // Parse optional continuation params from body
  let bodyParams: {
    org_id?: string;
    resume_after_id?: string;
    is_continuation?: boolean;
    continuation_of?: string;
    continuation_count?: number;
    run_cutoff_time?: string;
    chain_id?: string;
    trigger_source?: string;
    manual_initiator_user_id?: string;
    is_overflow?: boolean;
    /** Per-item timeout counts carried from previous rounds */
    item_timeout_counts?: Record<string, number>;
  } = {};
  try {
    if (req.method === "POST") {
      bodyParams = await req.json().catch(() => ({}));
    }
  } catch (_bodyErr) { /* no body */ }

  const isContinuation = bodyParams.is_continuation === true;
  const isOverflow = bodyParams.is_overflow === true;
  const resumeAfterId = bodyParams.resume_after_id || undefined;
  const continuationOf = bodyParams.continuation_of || undefined;
  const continuationCount = bodyParams.continuation_count ?? 0;
  // Item 1: run_cutoff_time — initial run sets it, continuations reuse it
  const runCutoffTime = bodyParams.run_cutoff_time || (isContinuation ? undefined : new Date().toISOString());
  const chainId = bodyParams.chain_id || runId;
  const triggerSource = bodyParams.trigger_source || "CRON";
  const manualInitiatorUserId = bodyParams.manual_initiator_user_id || null;
  // Carry forward per-item timeout counts across continuation rounds
  const inheritedTimeoutCounts: Record<string, number> = bodyParams.item_timeout_counts || {};

  // Guard: max continuations to prevent infinite loops
  if (isContinuation && continuationCount >= MAX_CONTINUATIONS) {
    console.warn(`[daily-sync] MAX_CONTINUATIONS (${MAX_CONTINUATIONS}) reached — scheduling overflow pass`);

    // Schedule overflow pass via DB flag (setTimeout won't survive function teardown)
    // The fallback-sync-check or continuation-guarantee will pick this up
    let overflowScheduled = false;
    if (!isOverflow && supabaseUrl && supabaseServiceKey) {
      try {
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);
        const overflowRunAt = new Date(Date.now() + OVERFLOW_DELAY_MS).toISOString();
        // Write overflow marker to the ledger so fallback-sync-check picks it up
        await adminClient.from("auto_sync_daily_ledger")
          .update({
            continuation_block_reason: "OVERFLOW_SCHEDULED",
            metadata: {
              overflow_run_at: overflowRunAt,
              overflow_resume_after_id: resumeAfterId,
              overflow_chain_id: chainId,
              overflow_trigger_source: triggerSource,
              overflow_manual_initiator: manualInitiatorUserId,
              overflow_item_timeout_counts: inheritedTimeoutCounts,
            },
          })
          .eq("chain_id", chainId)
          .eq("status", "PARTIAL")
          .order("created_at", { ascending: false })
          .limit(1);
        overflowScheduled = true;
        console.log(`[daily-sync] Overflow scheduled for ${overflowRunAt} via DB flag (chain=${chainId})`);
      } catch (overflowErr) {
        console.warn(`[daily-sync] Failed to write overflow flag:`, overflowErr);
      }
    }

    return new Response(
      JSON.stringify({
        ok: false,
        reason: "MAX_CONTINUATIONS_REACHED",
        continuation_count: continuationCount,
        chain_id: chainId,
        overflow_scheduled: overflowScheduled,
        overflow_delay_ms: OVERFLOW_DELAY_MS,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log(`[daily-sync] START run_id=${runId} chain_id=${chainId} continuation=${isContinuation} overflow=${isOverflow} count=${continuationCount} resume=${resumeAfterId?.slice(0, 8) ?? 'none'} budget_ms=${HARD_BUDGET_MS} cutoff=${runCutoffTime ?? 'inherited'} trigger=${triggerSource}`);

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase configuration", run_id: runId, chain_id: chainId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ── Heartbeat: start (try/finally guarantees finish) ──
  let hb: HeartbeatHandle | null = null;
  let topLevelError: Error | null = null;
  let responsePayload: Record<string, unknown> = {};
  let httpStatus = 200;

  // Accumulators visible to finally
  let totalSynced = 0;
  let totalErrors = 0;
  let totalDeadLettered = 0;
  let totalTimeouts = 0;

  try {
    hb = await startHeartbeat(supabase, "scheduled-daily-sync", triggerSource === "MANUAL" ? "manual_ui" : "cron", {
      run_id: runId,
      chain_id: chainId,
      trigger_source: triggerSource,
      continuation_count: continuationCount,
      is_continuation: isContinuation,
      is_overflow: isOverflow,
    });

    // ── Pre-flight API check BEFORE processing items ──
    if (!isContinuation) {
      try {
        console.log("[daily-sync] Running pre-flight check...");
        const { data: pfData, error: pfErr } = await supabase.functions.invoke("atenia-preflight-check", {
          body: { trigger: "PRE_DAILY_SYNC" },
        });

        if (!pfErr && pfData) {
          preflightDecision = pfData.decision;
          console.log(`[daily-sync] Pre-flight: ${pfData.overall} → decision=${pfData.decision}`);

          if (pfData.overall === "CRITICAL_FAILURE" && pfData.decision === "DELAY_SYNC") {
            console.warn("[daily-sync] Pre-flight CRITICAL — delaying sync");
            responsePayload = {
              ok: false,
              run_id: runId,
              chain_id: chainId,
              delayed: true,
              reason: "preflight_critical",
              preflight: { overall: pfData.overall, decision: pfData.decision },
            };
            return new Response(
              JSON.stringify(responsePayload),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      } catch (pfCatchErr) {
        console.warn("[daily-sync] Pre-flight check failed (non-blocking):", (pfCatchErr as Error).message);
      }
    }

    // ── Clean up stuck RUNNING entries from previous days ──
    const todayStr = new Date().toISOString().slice(0, 10);
    try {
      await supabase
        .from("auto_sync_daily_ledger")
        .update({ status: "FAILED" as any, finished_at: new Date().toISOString(), failure_reason: "TIMEOUT_STUCK_RUNNING" })
        .eq("status", "RUNNING")
        .lt("run_date", todayStr);
    } catch (_cleanupErr) { /* non-blocking cleanup */ }

    // ── Clean up same-day stuck RUNNING entries (> 30 min without heartbeat) ──
    try {
      const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabase
        .from("auto_sync_daily_ledger")
        .update({ status: "FAILED" as any, finished_at: new Date().toISOString(), failure_reason: "TIMEOUT_STUCK_RUNNING_30M" })
        .eq("status", "RUNNING")
        .eq("run_date", todayStr)
        .lt("last_heartbeat_at", stuckCutoff);
    } catch (_stuckErr) { /* non-blocking cleanup */ }

    // Determine which orgs to process
    let orgIds: string[];
    if (bodyParams.org_id) {
      orgIds = [bodyParams.org_id];
    } else {
      const { data: orgRows, error: orgErr } = await supabase
        .from("work_items")
        .select("organization_id")
        .eq("monitoring_enabled", true)
        .not("radicado", "is", null)
        .not("organization_id", "is", null);
      if (orgErr) throw orgErr;
      orgIds = [...new Set((orgRows || []).map((r: any) => r.organization_id).filter(Boolean))];
    }
    console.log(`[daily-sync] ${orgIds.length} org(s) with eligible items`);

    const allResults: Array<{
      org_id: string; status: string; synced: number; errors: number;
      dead_lettered: number; timeouts: number; ledger_id?: string;
      skipped?: number; failure_reason?: string;
      skipped_radicados?: string[];
      skipped_reasons?: Record<string, number>;
      timeout_items?: string[];
      item_timeout_counts?: Record<string, number>;
    }> = [];

    /** Shared buscar budget tracker across all orgs in this cron run */
    const buscarBudget = { used: 0, cap: MAX_BUSCAR_PER_CRON_CYCLE };

    for (const orgId of orgIds) {
      if (Date.now() - startTime > HARD_BUDGET_MS) {
        console.warn(`[daily-sync] Global budget exhausted before org ${orgId}`);
        break;
      }
      try {
        const result = await syncOrganization(
          supabase, supabaseUrl, supabaseServiceKey, orgId, runId, startTime,
          isContinuation ? resumeAfterId : undefined,
          isContinuation, continuationOf, runCutoffTime, chainId,
          triggerSource, manualInitiatorUserId, isOverflow, inheritedTimeoutCounts,
          buscarBudget,
        );
        allResults.push(result);
      } catch (orgError: any) {
        console.error(`[daily-sync] Org ${orgId} fatal:`, orgError.message);
        allResults.push({ org_id: orgId, status: "FAILED", synced: 0, errors: 1, dead_lettered: 0, timeouts: 0 });
      }
    }

    const durationMs = Date.now() - startTime;
    totalSynced = allResults.reduce((s, r) => s + r.synced, 0);
    totalErrors = allResults.reduce((s, r) => s + r.errors, 0);
    totalDeadLettered = allResults.reduce((s, r) => s + r.dead_lettered, 0);
    totalTimeouts = allResults.reduce((s, r) => s + r.timeouts, 0);

    // Legacy job_runs log
    try {
      await supabase.from("job_runs").insert({
        job_name: "scheduled-daily-sync",
        status: totalErrors === 0 ? "OK" : "PARTIAL",
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
        processed_count: totalSynced,
        metadata: { run_id: runId, chain_id: chainId, continuation_count: continuationCount, is_overflow: isOverflow, results: allResults.slice(0, 20) },
      });
    } catch (_logErr) { /* non-blocking */ }

    // ── AUTO-CONTINUATION: Schedule follow-up for PARTIAL/BUDGET_EXHAUSTED runs ──
    const partialOrgs = allResults.filter(r =>
      r.status === "PARTIAL" || r.status === "CONTINUING" ||
      (r.status === "FAILED" && r.failure_reason === "BUDGET_EXHAUSTED")
    );
    for (const partialResult of partialOrgs) {
      try {
        const { data: ledgerRow } = await supabase
          .from("auto_sync_daily_ledger")
          .select("cursor_last_work_item_id, run_cutoff_time, items_skipped, items_succeeded, failure_reason")
          .eq("id", partialResult.ledger_id)
          .maybeSingle();

        const cursor = ledgerRow?.cursor_last_work_item_id;
        const effectiveCutoff = ledgerRow?.run_cutoff_time || runCutoffTime;

        if (cursor && cursor === resumeAfterId) {
          console.warn(`[daily-sync] No progress detected for org=${partialResult.org_id} — cursor unchanged (${cursor.slice(0, 8)}). Stopping chain.`);
          await supabase.from("auto_sync_daily_ledger").update({
            continuation_enqueued: false,
            continuation_block_reason: "NO_PROGRESS_CURSOR_UNCHANGED",
          }).eq("id", partialResult.ledger_id);
          continue;
        }

        const hasSkippedWork = (ledgerRow?.items_skipped ?? partialResult.skipped ?? 0) > 0;
        const hasBudgetExhaustion = (ledgerRow?.failure_reason === "BUDGET_EXHAUSTED") || (partialResult.failure_reason === "BUDGET_EXHAUSTED");
        if (partialResult.synced === 0 && !hasSkippedWork && !hasBudgetExhaustion) {
          console.warn(`[daily-sync] No items synced and no skipped work for org=${partialResult.org_id} — stopping chain to prevent infinite loop.`);
          await supabase.from("auto_sync_daily_ledger").update({
            continuation_enqueued: false,
            continuation_block_reason: "NO_PENDING_WORK",
          }).eq("id", partialResult.ledger_id);
          continue;
        }

        if (cursor) {
          const nextCount = continuationCount + 1;
          // Merge item_timeout_counts from this run for the next continuation
          const mergedTimeoutCounts = { ...inheritedTimeoutCounts, ...(partialResult.item_timeout_counts || {}) };
          console.log(`[daily-sync] Scheduling continuation #${nextCount} for org=${partialResult.org_id} cursor=${cursor.slice(0, 8)} chain=${chainId} (skipped=${ledgerRow?.items_skipped ?? '?'}, reason=${ledgerRow?.failure_reason ?? 'none'})`);
          fetch(`${supabaseUrl}/functions/v1/scheduled-daily-sync`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseServiceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              org_id: partialResult.org_id,
              resume_after_id: cursor,
              is_continuation: true,
              continuation_of: partialResult.ledger_id,
              continuation_count: nextCount,
              run_cutoff_time: effectiveCutoff,
              chain_id: chainId,
              trigger_source: triggerSource,
              manual_initiator_user_id: manualInitiatorUserId,
              is_overflow: isOverflow,
              item_timeout_counts: mergedTimeoutCounts,
            }),
          }).catch(err => console.warn(`[daily-sync] Continuation trigger failed:`, err));
          await supabase.from("auto_sync_daily_ledger").update({
            continuation_enqueued: true,
          }).eq("id", partialResult.ledger_id);
        } else {
          await supabase.from("auto_sync_daily_ledger").update({
            continuation_enqueued: false,
            continuation_block_reason: "NO_CURSOR",
          }).eq("id", partialResult.ledger_id);
        }
      } catch (contErr) {
        console.warn(`[daily-sync] Failed to schedule continuation for org ${partialResult.org_id}:`, contErr);
      }
    }

    // Fire-and-forget Atenia AI post-sync (only after non-continuation completes)
    if (!isContinuation || partialOrgs.length === 0) {
      supabase.functions.invoke("atenia-ai-supervisor", {
        body: { mode: "POST_DAILY_SYNC" },
      }).catch(() => {});
    }

    responsePayload = {
      ok: true,
      run_id: runId,
      chain_id: chainId,
      duration_ms: durationMs,
      budget_ms: HARD_BUDGET_MS,
      continuation_count: continuationCount,
      max_continuations: MAX_CONTINUATIONS,
      is_continuation: isContinuation,
      is_overflow: isOverflow,
      run_cutoff_time: runCutoffTime,
      trigger_source: triggerSource,
      orgs: allResults,
      continuations_scheduled: partialOrgs.length,
      total_synced: totalSynced,
      total_errors: totalErrors,
      total_dead_lettered: totalDeadLettered,
      total_timeouts: totalTimeouts,
    };
    httpStatus = 200;
  } catch (error: any) {
    topLevelError = error;
    console.error("[daily-sync] Fatal:", error.message);
    responsePayload = { ok: false, error: error.message, run_id: runId, chain_id: chainId };
    httpStatus = 500;
  } finally {
    // ── Heartbeat: ALWAYS finalize ──
    if (hb) {
      const hbStatus: "OK" | "ERROR" = topLevelError ? "ERROR" : totalErrors > 0 ? "ERROR" : "OK";
      const errorCode = topLevelError ? "UNHANDLED_EXCEPTION"
        : totalErrors > 0 ? "PARTIAL_FAILURES"
        : null;
      try {
        await finishHeartbeat(supabase, hb, hbStatus, {
          errorCode: errorCode ?? undefined,
          errorMessage: topLevelError?.message ?? (totalErrors > 0 ? `${totalErrors} item errors across orgs` : undefined),
          metadata: {
            run_id: runId,
            chain_id: chainId,
            trigger_source: triggerSource,
            organization_id: bodyParams.org_id ?? null,
            is_continuation: isContinuation,
            is_overflow: isOverflow,
            continuation_of: continuationOf ?? null,
            continuation_count: continuationCount,
            resume_after_id: resumeAfterId ?? null,
            total_synced: totalSynced,
            total_errors: totalErrors,
            total_dead_lettered: totalDeadLettered,
            total_timeouts: totalTimeouts,
          },
        });
      } catch (hbErr) {
        console.error("[daily-sync] CRITICAL: finishHeartbeat failed:", hbErr);
      }
    }

    // ── Trace record: write structured cron trace to atenia_cron_runs ──
    try {
      const traceRunMode = isOverflow ? "OVERFLOW" as const
        : isContinuation ? "CONTINUATION" as const
        : triggerSource === "MANUAL" ? "MANUAL" as const
        : "CRON" as const;
      const trace = createTraceContext("scheduled-daily-sync", traceRunMode, {
        cron_run_id: runId,
        org_id: bodyParams.org_id,
        chain_id: chainId,
      });
      const traceStatus = topLevelError ? "ERROR" as const
        : totalErrors > 0 ? "PARTIAL" as const
        : "OK" as const;
      const traceDetails: TraceDetails = {
        work_items_scanned: totalSynced + totalErrors,
        continuation_count: continuationCount,
        is_continuation: isContinuation,
        is_overflow: isOverflow,
        preflight_decision: preflightDecision ?? null,
        total_synced: totalSynced,
        total_errors: totalErrors,
        total_dead_lettered: totalDeadLettered,
        total_timeouts: totalTimeouts,
      };
      if (topLevelError) {
        traceDetails.errors = [{ code: "FATAL", message: topLevelError.message, count: 1 }];
      }
      await writeTraceRecord(supabase, trace, traceStatus, traceDetails, new Date(startTime));
    } catch (_traceErr) {
      console.warn("[daily-sync] Trace record write failed (non-blocking)");
    }
  }

  return new Response(
    JSON.stringify(responsePayload),
    { status: httpStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// ─── Per-org sync with cursor pagination, error isolation, budget tracking ───

async function syncOrganization(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  orgId: string,
  runId: string,
  globalStart: number,
  resumeAfterId?: string,
  isContinuation: boolean = false,
  continuationOf?: string,
  runCutoffTime?: string,
  chainId?: string,
  triggerSource: string = "CRON",
  manualInitiatorUserId: string | null = null,
  isOverflow: boolean = false,
  inheritedTimeoutCounts: Record<string, number> = {},
  buscarBudget: { used: number; cap: number } = { used: 0, cap: MAX_BUSCAR_PER_CRON_CYCLE },
): Promise<{
  org_id: string; status: string; synced: number; errors: number;
  dead_lettered: number; timeouts: number; ledger_id?: string;
  skipped?: number; failure_reason?: string;
  skipped_radicados?: string[];
  skipped_reasons?: Record<string, number>;
  timeout_items?: string[];
  item_timeout_counts?: Record<string, number>;
}> {
  console.log(`[daily-sync] org=${orgId} starting continuation=${isContinuation} overflow=${isOverflow} cutoff=${runCutoffTime ?? 'none'}`);

  let ledgerId: string;

  if (isContinuation && continuationOf) {
    // Item 2: For continuations, check that the org isn't already being synced
    const today = new Date().toISOString().slice(0, 10);
    
    const { data: runningEntries } = await supabase
      .from("auto_sync_daily_ledger")
      .select("id, chain_id, last_heartbeat_at")
      .eq("organization_id", orgId)
      .eq("run_date", today)
      .eq("status", "RUNNING");
    
    const activeOtherChain = (runningEntries || []).find((e: any) => 
      e.chain_id && e.chain_id !== chainId &&
      e.last_heartbeat_at && new Date(e.last_heartbeat_at) > new Date(Date.now() - 5 * 60 * 1000)
    );
    
    if (activeOtherChain) {
      console.warn(`[daily-sync] org=${orgId} skip continuation: another chain ${activeOtherChain.chain_id} is active`);
      return { org_id: orgId, status: "SKIPPED_LOCK", synced: 0, errors: 0, dead_lettered: 0, timeouts: 0 };
    }

    const { data: newLedger, error: insertErr } = await supabase
      .from("auto_sync_daily_ledger")
      .insert({
        organization_id: orgId,
        run_date: today,
        scheduled_for: new Date().toISOString(),
        status: "RUNNING",
        run_id: runId,
        chain_id: chainId,
        run_cutoff_time: runCutoffTime,
        is_continuation: true,
        continuation_of: continuationOf,
        started_at: new Date().toISOString(),
        last_heartbeat_at: new Date().toISOString(),
        trigger_source: triggerSource,
        manual_initiator_user_id: manualInitiatorUserId,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;
    ledgerId = newLedger.id;
  } else {
    // Acquire lock via ledger (normal run)
    const { data: lockResult, error: lockError } = await supabase.rpc("acquire_daily_sync_lock", {
      p_organization_id: orgId,
      p_run_id: runId,
    });
    if (lockError) throw lockError;

    const lock = lockResult as { acquired: boolean; ledger_id: string; status: string; reason?: string };
    if (!lock.acquired) {
      console.log(`[daily-sync] org=${orgId} skip: ${lock.reason}`);
      return { org_id: orgId, status: lock.status, synced: 0, errors: 0, dead_lettered: 0, timeouts: 0, ledger_id: lock.ledger_id };
    }
    ledgerId = lock.ledger_id;

    // Write chain_id, run_cutoff_time, trigger_source to ledger on initial acquisition
    await supabase
      .from("auto_sync_daily_ledger")
      .update({
        chain_id: chainId,
        run_cutoff_time: runCutoffTime,
        trigger_source: triggerSource,
        manual_initiator_user_id: manualInitiatorUserId,
      })
      .eq("id", ledgerId);
  }

  let itemsSucceeded = 0;
  let itemsFailed = 0;
  let itemsSkipped = 0;
  let deadLetterCount = 0;
  let timeoutCount = 0;
  let cursorLastId: string | null = null;
  let failureReason: string | null = null;
  const errorSummary: Array<{
    work_item_id: string; radicado?: string; error: string; ts: string;
    is_timeout?: boolean; is_dead_letter?: boolean; skip_reason?: string;
  }> = [];

  // ── Fix #3: Per-item timeout tracking across the chain ──
  const itemTimeoutCounts: Record<string, number> = { ...inheritedTimeoutCounts };

  // ── Fix #4: Observability accumulators ──
  const skippedRadicados: string[] = [];
  const skippedReasons: Record<string, number> = {};
  const timeoutItems: string[] = [];

  // Helper to record a skip reason
  function recordSkip(radicado: string | undefined, reason: string) {
    if (radicado) skippedRadicados.push(radicado);
    skippedReasons[reason] = (skippedReasons[reason] || 0) + 1;
  }

  try {
    // Load dead-lettered item IDs for this org to exclude them
    const { data: deadLetterRows } = await supabase
      .from("sync_item_failure_tracker")
      .select("work_item_id")
      .eq("organization_id", orgId)
      .eq("dead_lettered", true);
    const deadLetteredIds = (deadLetterRows || []).map((r: any) => r.work_item_id);

    // Count total eligible items
    const allItems = await selectEligibleWorkItems(supabase, orgId, {
      afterId: isContinuation ? resumeAfterId : undefined,
      cutoffTime: runCutoffTime,
      excludeIds: deadLetteredIds,
    });
    const expectedTotal = allItems.length;

    console.log(`[daily-sync] org=${orgId} eligible=${expectedTotal} dead_lettered_excluded=${deadLetteredIds.length} continuation=${isContinuation} overflow=${isOverflow}`);

    // Write ledger RUNNING with expected_total
    await updateLedger(supabase, ledgerId, {
      status: "RUNNING",
      items_targeted: expectedTotal,
      expected_total_items: expectedTotal,
    });

    // ── Fix #2 & #3: Items that failed/timed-out this round, eligible for intra-round retry ──
    interface FailedItem {
      item: EligibleWorkItem;
      error: string;
      isTimeout: boolean;
      attemptCount: number;
    }

    // Cursor-driven pagination through items, ordered by id ASC
    let cursor: string | undefined = isContinuation ? resumeAfterId : undefined;
    let pageItems: EligibleWorkItem[];
    let processedCount = 0;
    // Track per-item attempt count within this chain invocation
    const itemAttemptCounts: Record<string, number> = {};

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
        cutoffTime: runCutoffTime,
        excludeIds: deadLetteredIds,
      });

      if (pageItems.length === 0) break;

      // ── Process each item with error isolation ──
      const roundFailures: FailedItem[] = [];

      for (const item of pageItems) {
        // Per-item budget check
        if (Date.now() - globalStart > HARD_BUDGET_MS) {
          failureReason = "BUDGET_EXHAUSTED";
          itemsSkipped += (pageItems.length - pageItems.indexOf(item));
          break;
        }

        const attemptNum = (itemAttemptCounts[item.id] || 0) + 1;
        itemAttemptCounts[item.id] = attemptNum;

        // Check if we've exceeded max attempts for this item in this chain
        if (attemptNum > MAX_ITEM_ATTEMPTS_PER_CHAIN) {
          itemsSkipped++;
          recordSkip(item.radicado, "MAX_ATTEMPTS_EXCEEDED");
          continue;
        }

        try {
          const allowBuscar = buscarBudget.used < buscarBudget.cap;
          const syncResponse = await syncSingleItemWithTimeout(supabase, item, orgId, ITEM_TIMEOUT_MS, allowBuscar);
          
          // Track buscar usage from response
          if (syncResponse?.cpnu_buscar_used) {
            buscarBudget.used++;
            console.log(`[daily-sync] buscar used for ${item.radicado?.slice(0,10)}, budget=${buscarBudget.used}/${buscarBudget.cap}`);
          }
          // If buscar was deferred (stale but cap reached), mark for next run
          if (syncResponse?.cpnu_buscar_deferred) {
            await markNeedsCpnuRefresh(supabase, item.id, true);
            console.log(`[daily-sync] needs_cpnu_refresh=true for ${item.radicado?.slice(0,10)} (buscar cap reached)`);
          } else if (syncResponse?.cpnu_buscar_used) {
            // Buscar was used successfully — clear the flag
            await markNeedsCpnuRefresh(supabase, item.id, false);
          }
          
          itemsSucceeded++;
          // Reset failure counter on success
          await resetItemFailures(supabase, item.id);
          // Reset timeout count on success
          delete itemTimeoutCounts[item.id];
        } catch (err: any) {
          const isTimeout = err.message?.includes("ITEM_TIMEOUT");
          if (isTimeout) {
            timeoutCount++;
            const chainTimeouts = (itemTimeoutCounts[item.id] || 0) + 1;
            itemTimeoutCounts[item.id] = chainTimeouts;
            if (item.radicado) timeoutItems.push(item.radicado);

            // Fix #3: Check if timeout exhausted (3 timeouts across chain)
            if (chainTimeouts >= 3) {
              itemsFailed++;
              recordSkip(item.radicado, "TIMEOUT_EXHAUSTED");
              errorSummary.push({
                work_item_id: item.id,
                radicado: item.radicado,
                error: `TIMEOUT_EXHAUSTED: ${chainTimeouts} timeouts across chain`,
                ts: new Date().toISOString(),
                is_timeout: true,
                skip_reason: "TIMEOUT_EXHAUSTED",
              });
              // Track failure for dead-lettering
              const wasDeadLettered = await trackItemFailure(supabase, item.id, orgId, runId, err.message);
              if (wasDeadLettered) {
                deadLetterCount++;
                errorSummary[errorSummary.length - 1].is_dead_letter = true;
              }
              continue; // Don't retry — will be picked up by overflow pass
            }
          }

          // Collect for intra-round retry
          roundFailures.push({
            item,
            error: (err.message || String(err)).substring(0, 200),
            isTimeout,
            attemptCount: attemptNum,
          });

          itemsFailed++;
          errorSummary.push({
            work_item_id: item.id,
            radicado: item.radicado,
            error: (err.message || String(err)).substring(0, 200),
            ts: new Date().toISOString(),
            is_timeout: isTimeout,
            skip_reason: isTimeout ? "TIMEOUT" : "API_ERROR",
          });

          // Track consecutive failure
          const wasDeadLettered = await trackItemFailure(supabase, item.id, orgId, runId, err.message);
          if (wasDeadLettered) {
            deadLetterCount++;
            errorSummary[errorSummary.length - 1].is_dead_letter = true;
            console.warn(`[daily-sync] DEAD-LETTERED item=${item.id.slice(0, 8)} radicado=${item.radicado} after ${DEAD_LETTER_THRESHOLD} consecutive failures`);
          }
        }

        cursorLastId = item.id;
        processedCount++;
      }

      // ── Fix #2: Intra-round retry of failed items (once per item) ──
      if (roundFailures.length > 0 && !failureReason && Date.now() - globalStart < HARD_BUDGET_MS - 15_000) {
        const retryableItems = roundFailures.filter(f => {
          // Don't retry dead-lettered or timeout-exhausted items
          if (f.isTimeout && (itemTimeoutCounts[f.item.id] || 0) >= 3) return false;
          // Check max attempts
          if ((itemAttemptCounts[f.item.id] || 0) >= MAX_ITEM_ATTEMPTS_PER_CHAIN) return false;
          return true;
        });

        if (retryableItems.length > 0) {
          // Fix #3: Apply appropriate backoff delay
          const maxTimeouts = Math.max(...retryableItems.map(f => itemTimeoutCounts[f.item.id] || 0));
          const backoffDelay = maxTimeouts >= 2
            ? TIMEOUT_BACKOFF_MS[1] // 30s for 2nd+ timeout
            : maxTimeouts >= 1
              ? TIMEOUT_BACKOFF_MS[0] // 10s for 1st timeout
              : INTRA_ROUND_RETRY_DELAY_MS; // 5s for non-timeout errors

          console.log(`[daily-sync] org=${orgId} intra-round retry: ${retryableItems.length} items, delay=${backoffDelay}ms`);
          await new Promise(r => setTimeout(r, backoffDelay));

          for (const { item } of retryableItems) {
            if (Date.now() - globalStart > HARD_BUDGET_MS) {
              failureReason = "BUDGET_EXHAUSTED";
              break;
            }

            const retryAttemptNum = (itemAttemptCounts[item.id] || 0) + 1;
            itemAttemptCounts[item.id] = retryAttemptNum;

            if (retryAttemptNum > MAX_ITEM_ATTEMPTS_PER_CHAIN) continue;

            try {
              const retryAllowBuscar = buscarBudget.used < buscarBudget.cap;
              const retrySyncResponse = await syncSingleItemWithTimeout(supabase, item, orgId, ITEM_TIMEOUT_MS, retryAllowBuscar);
              if (retrySyncResponse?.cpnu_buscar_used) buscarBudget.used++;
              if (retrySyncResponse?.cpnu_buscar_deferred) {
                await markNeedsCpnuRefresh(supabase, item.id, true);
              } else if (retrySyncResponse?.cpnu_buscar_used) {
                await markNeedsCpnuRefresh(supabase, item.id, false);
              }
              // Retry succeeded! Fix counts
              itemsSucceeded++;
              itemsFailed--; // Undo the earlier failure count
              await resetItemFailures(supabase, item.id);
              delete itemTimeoutCounts[item.id];
              // Remove from skipped tracking
              const skipIdx = skippedRadicados.indexOf(item.radicado);
              if (skipIdx >= 0) skippedRadicados.splice(skipIdx, 1);
              console.log(`[daily-sync] org=${orgId} retry SUCCESS for ${item.radicado}`);
            } catch (retryErr: any) {
              const isRetryTimeout = retryErr.message?.includes("ITEM_TIMEOUT");
              if (isRetryTimeout) {
                timeoutCount++;
                itemTimeoutCounts[item.id] = (itemTimeoutCounts[item.id] || 0) + 1;
                if (item.radicado) timeoutItems.push(item.radicado);
              }
              recordSkip(item.radicado, isRetryTimeout ? "TIMEOUT" : "API_ERROR");
              errorSummary.push({
                work_item_id: item.id,
                radicado: item.radicado,
                error: `RETRY_FAILED: ${(retryErr.message || String(retryErr)).substring(0, 150)}`,
                ts: new Date().toISOString(),
                is_timeout: isRetryTimeout,
                skip_reason: isRetryTimeout ? "TIMEOUT" : "API_ERROR",
              });
              // Item stays as failed — it was already counted
              console.log(`[daily-sync] org=${orgId} retry FAILED for ${item.radicado}: ${retryErr.message?.substring(0, 80)}`);
            }
          }
        }
      }

      cursor = pageItems[pageItems.length - 1]?.id;

      // Progress heartbeat to ledger after each page
      await updateLedger(supabase, ledgerId, {
        status: "RUNNING",
        items_succeeded: itemsSucceeded,
        items_failed: itemsFailed,
        items_skipped: itemsSkipped,
        cursor_last_work_item_id: cursorLastId,
        error_summary: errorSummary.slice(0, 50),
        dead_letter_count: deadLetterCount,
        timeout_count: timeoutCount,
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
    if (failureReason === "BUDGET_EXHAUSTED") {
      // Use BUDGET_OVERFLOW if this was an overflow pass
      finalStatus = isOverflow ? "BUDGET_OVERFLOW" : "PARTIAL";
    } else if (itemsFailed === 0 && totalAttempted >= expectedTotal) {
      finalStatus = "SUCCESS";
    } else if (itemsSucceeded > 0 && totalAttempted > 0) {
      const successRate = itemsSucceeded / totalAttempted;
      finalStatus = successRate >= SUCCESS_THRESHOLD ? "SUCCESS" : "PARTIAL";
    } else if (itemsSucceeded === 0 && totalAttempted > 0) {
      finalStatus = "FAILED";
    } else if (expectedTotal === 0) {
      finalStatus = "SUCCESS";
    } else {
      finalStatus = "FAILED";
    }

    // ── Fix #4: Enriched metadata with skip observability ──
    const enrichedMetadata = {
      run_id: runId,
      chain_id: chainId,
      run_cutoff_time: runCutoffTime,
      duration_ms: Date.now() - globalStart,
      page_size: PAGE_SIZE,
      budget_ms: HARD_BUDGET_MS,
      item_timeout_ms: ITEM_TIMEOUT_MS,
      continuation_count: isContinuation ? (continuationOf ? 'chained' : 'first') : 'initial',
      is_overflow: isOverflow,
      items_processed: itemsSucceeded + itemsFailed,
      remaining_estimate: itemsSkipped,
      dead_letter_count: deadLetterCount,
      timeout_count: timeoutCount,
      dead_lettered_excluded: deadLetteredIds.length,
      // New observability fields
      skipped_radicados: skippedRadicados.slice(0, 50),
      skipped_reasons: skippedReasons,
      timeout_items: [...new Set(timeoutItems)].slice(0, 50),
      // CPNU buscar budget tracking
      cpnu_buscar_used: buscarBudget.used,
      cpnu_buscar_cap: buscarBudget.cap,
    };

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
      dead_letter_count: deadLetterCount,
      timeout_count: timeoutCount,
      metadata: enrichedMetadata,
    });

    // Auto-demonitor policy
    await runAutoDemonitor(supabase, orgId);

    console.log(`[daily-sync] org=${orgId} done: ${finalStatus} ${itemsSucceeded}✅ ${itemsFailed}❌ ${itemsSkipped}⏭️ ${deadLetterCount}💀 ${timeoutCount}⏱️ / ${expectedTotal} overflow=${isOverflow}`);
    return {
      org_id: orgId, status: finalStatus, synced: itemsSucceeded, errors: itemsFailed,
      dead_lettered: deadLetterCount, timeouts: timeoutCount, ledger_id: ledgerId,
      skipped: itemsSkipped, failure_reason: failureReason,
      skipped_radicados: skippedRadicados.slice(0, 50),
      skipped_reasons: skippedReasons,
      timeout_items: [...new Set(timeoutItems)].slice(0, 50),
      item_timeout_counts: itemTimeoutCounts,
    };

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

// ─── Item 5: Sync a single work item with timeout ───

interface SyncItemResponse {
  cpnu_buscar_used?: boolean;
  cpnu_buscar_deferred?: boolean;
}

async function syncSingleItemWithTimeout(
  supabase: any, item: EligibleWorkItem, orgId: string, timeoutMs: number, allowBuscar: boolean = true,
): Promise<SyncItemResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    return await syncSingleItem(supabase, item, orgId, controller.signal, allowBuscar);
  } catch (err: any) {
    if (err.name === "AbortError" || controller.signal.aborted) {
      throw new Error(`ITEM_TIMEOUT: sync for ${item.id.slice(0, 8)} exceeded ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Sync a single work item (acts + pubs) ───

async function syncSingleItem(
  supabase: any, item: EligibleWorkItem, orgId: string, signal?: AbortSignal, allowBuscar: boolean = true,
): Promise<SyncItemResponse | null> {
  // Sync actuaciones
  const { data: syncResult, error: syncError } = await supabase.functions.invoke(
    "sync-by-work-item",
    { body: { work_item_id: item.id, _scheduled: true, allow_buscar: allowBuscar } },
  );
  
  // Check abort between calls
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  
  if (syncError) throw syncError;

  const syncOk = shouldCountAsSuccess(syncResult);

  // FIX: Only update last_synced_at on SUCCESS to prevent masking sync failures.
  // On failure, update last_attempted_sync_at for observability without hiding staleness.
  if (syncOk) {
    await supabase
      .from("work_items")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", item.id);
  } else {
    await supabase
      .from("work_items")
      .update({ last_attempted_sync_at: new Date().toISOString() } as any)
      .eq("id", item.id);
  }

  // Sync publicaciones if act sync succeeded and workflow supports it
  if (
    syncOk &&
    shouldRunPublicaciones(syncResult) &&
    (PUBLICACIONES_WORKFLOWS as readonly string[]).includes(item.workflow_type)
  ) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    
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
      } catch (_retryErr) { /* non-blocking */ }
    } else {
      if ((item.total_actuaciones || 0) >= 100) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      try {
        await supabase.functions.invoke("sync-publicaciones-by-work-item", {
          body: { work_item_id: item.id, _scheduled: true },
        });
      } catch (_pubErr) {
        // Pub errors don't count as item failure
      }
    }

    // ── Sync PP actuaciones (23-digit radicados) ──
    if (syncOk && item.radicado?.replace(/\D/g, "").length === 23) {
      try {
        await supabase.functions.invoke("sync-pp-by-work-item", {
          body: { work_item_id: item.id, _scheduled: true },
        });
      } catch (_ppErr) {
        // PP sync errors are non-blocking
      }
    }
  }

  // If sync wasn't successful and wasn't scraping_pending, this is a soft failure
  if (!syncOk && !isScrapingPending(syncResult)) {
    if (syncResult?.ok === false) {
      throw new Error(syncResult?.message || syncResult?.code || "sync returned ok=false");
    }
  }

  // Return CPNU buscar metadata for caller to track budget
  return {
    cpnu_buscar_used: syncResult?.cpnu_buscar_used ?? false,
    cpnu_buscar_deferred: syncResult?.cpnu_buscar_deferred ?? false,
  };
}

// ─── Per-item failure tracking ───

async function trackItemFailure(supabase: any, workItemId: string, orgId: string, runId: string, errorMsg?: string): Promise<boolean> {
  try {
    const { data: existing } = await supabase
      .from("sync_item_failure_tracker")
      .select("consecutive_failures, dead_lettered")
      .eq("work_item_id", workItemId)
      .maybeSingle();

    if (existing?.dead_lettered) return false;

    const newCount = (existing?.consecutive_failures || 0) + 1;
    const shouldDeadLetter = newCount >= DEAD_LETTER_THRESHOLD;

    await supabase
      .from("sync_item_failure_tracker")
      .upsert({
        work_item_id: workItemId,
        organization_id: orgId,
        consecutive_failures: newCount,
        last_failure_at: new Date().toISOString(),
        last_failure_reason: (errorMsg || "unknown").substring(0, 500),
        dead_lettered: shouldDeadLetter,
        dead_lettered_at: shouldDeadLetter ? new Date().toISOString() : null,
        dead_lettered_run_id: shouldDeadLetter ? runId : null,
      }, { onConflict: "work_item_id" });

    return shouldDeadLetter;
  } catch (err) {
    console.warn(`[daily-sync] Failed to track item failure for ${workItemId}:`, err);
    return false;
  }
}

async function resetItemFailures(supabase: any, workItemId: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("sync_item_failure_tracker")
      .select("consecutive_failures")
      .eq("work_item_id", workItemId)
      .maybeSingle();

    if (existing && existing.consecutive_failures > 0) {
      await supabase
        .from("sync_item_failure_tracker")
        .update({
          consecutive_failures: 0,
          dead_lettered: false,
          dead_lettered_at: null,
          dead_lettered_run_id: null,
          reset_at: new Date().toISOString(),
        })
        .eq("work_item_id", workItemId);
    }
  } catch (_nbErr) { /* non-blocking */ }
}

// ─── Ledger update helper ───

async function updateLedger(supabase: any, ledgerId: string, fields: Record<string, any>): Promise<void> {
  try {
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
    if (fields.dead_letter_count !== undefined) updatePayload.dead_letter_count = fields.dead_letter_count;
    if (fields.timeout_count !== undefined) updatePayload.timeout_count = fields.timeout_count;

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

// ─── Auto-demonitor (condensed from original) + Ghost item cleanup ───

async function runAutoDemonitor(supabase: any, orgId: string): Promise<void> {
  try {
    const { data: aiConfig } = await supabase
      .from("atenia_ai_config")
      .select("auto_demonitor_after_404s")
      .eq("organization_id", orgId)
      .maybeSingle();

    const threshold = aiConfig?.auto_demonitor_after_404s ?? 5;
    if (threshold <= 0) return;

    const { data: rawCandidates } = await supabase
      .from("work_items")
      .select("id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at, monitoring_enabled")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .gte("consecutive_404_count", threshold);

    const { data: ghostStates } = await supabase
      .from("atenia_ai_work_item_state")
      .select("work_item_id, consecutive_not_found, last_error_code")
      .eq("organization_id", orgId)
      .gte("consecutive_not_found", threshold);

    const rawCandidateIds = new Set((rawCandidates || []).map((c: any) => c.id));
    const ghostOnlyIds = (ghostStates || [])
      .map((g: any) => g.work_item_id)
      .filter((id: string) => !rawCandidateIds.has(id));

    let allCandidates = [...(rawCandidates || [])];

    if (ghostOnlyIds.length > 0) {
      const { data: ghostItems } = await supabase
        .from("work_items")
        .select("id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at, monitoring_enabled")
        .in("id", ghostOnlyIds)
        .eq("monitoring_enabled", true);

      if (ghostItems) {
        for (const gi of ghostItems) {
          const state = (ghostStates || []).find((g: any) => g.work_item_id === gi.id);
          if (state) {
            gi.consecutive_404_count = Math.max(gi.consecutive_404_count || 0, state.consecutive_not_found);
            gi.last_error_code = gi.last_error_code || state.last_error_code;
          }
        }
        allCandidates = [...allCandidates, ...ghostItems];
      }
    }

    if (allCandidates.length === 0) return;

    const candidates = await enrichDemonitorCandidates(supabase, allCandidates);

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

    for (const id of demonitorIds) {
      try {
        await supabase
          .from("atenia_ai_work_item_state")
          .update({
            consecutive_not_found: 0,
            consecutive_other_errors: 0,
            last_error_code: "DEMONITORED",
          })
          .eq("work_item_id", id);
      } catch (_nbErr2) { /* non-blocking */ }
    }

    for (const item of toDemonitor.slice(0, 10)) {
      try {
        await supabase.from("atenia_ai_actions").insert({
          organization_id: orgId,
          action_type: "AUTO_DEMONITOR",
          autonomy_tier: "ACT",
          reasoning: `Radicado ${item.radicado || "N/A"}: ${item.consecutive_404_count} 404s consecutivos (umbral: ${threshold}). Ghost items policy aplicada.`,
          target_entity_type: "WORK_ITEM",
          target_entity_id: item.id,
          action_taken: "monitoring_disabled",
          action_result: "SUCCESS",
          evidence: buildAuditEvidence({ item, retryRowPresent: false, threshold }),
        });
      } catch (_nbErr3) { /* non-blocking */ }
    }

    console.log(`[daily-sync] Auto-demonitor: ${toDemonitor.length} items (incl. ${ghostOnlyIds.length} ghost items)`);
  } catch (err) {
    console.warn("[daily-sync] Auto-demonitor error:", err);
  }
}
