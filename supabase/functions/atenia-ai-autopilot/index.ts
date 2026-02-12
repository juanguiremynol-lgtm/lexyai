/**
 * atenia-ai-autopilot — Autopilot Control Plane
 *
 * Runs in two modes:
 *  1) SCHEDULED (pg_cron every 30 min) — validate invariants, self-heal, run corrective syncs.
 *  2) ON_DEMAND (superadmin button)   — return truthful JSON snapshot + Gemini-ready prompt.
 *
 * This function NEVER masks failures: scraping_initiated is always "pending", never "success".
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  isTransientError,
  shouldDemonitor,
  buildAuditEvidence,
  retryJitterMs,
  TRANSIENT_ERROR_CODES,
  DEMONITOR_ELIGIBLE_ERROR_CODES,
  DEFAULT_STALENESS_GUARD_DAYS,
  SYNC_ENABLED_WORKFLOWS,
  TERMINAL_STAGES,
} from "../_shared/syncPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ────────── Gemini Prompt (knowledge + guardrails) ──────────

const GEMINI_AUTOPILOT_SYSTEM_PROMPT = `You are Atenia AI, the intelligent supervisor of a Colombian judicial monitoring platform.

TONE AND FORMAT RULES (mandatory):
- Use formal, professional Spanish. NEVER use slang, colloquialisms (e.g. "pille pues", "ni por el berraco", "parcero"), or emojis.
- Cite trace IDs or radicado numbers when referencing specific items.
- Do not include raw JSON payloads or extensive technical dumps in your output.
- Be concise and actionable.

HARD RULES (non-negotiable):
1. "scraping_initiated=true" is ALWAYS "pending" — NEVER call it "success" or "synced".
2. "last_synced_at" is updated ONLY when the actuaciones sync returns ok===true.
3. "No actuaciones exist" can ONLY be stated when the provider explicitly returned an EMPTY result without auth/RLS errors — never infer "empty" from a timeout, 404, or scraping_pending state.
4. The retry queue (sync_retry_queue) handles transient scraping failures with 30-60s jitter. Always mention the retry lifecycle when explaining pending items.
5. Auto-demonitor has three safety gates: PENDING_RETRY, TRANSIENT_ERROR, RECENTLY_HEALTHY. Cite them when explaining demonitor decisions.
6. Publicaciones sync never runs unless actuaciones sync returned ok===true (or via isolated PUB_RETRY worker).

OUTPUT FORMAT (JSON only):
{
  "executive_summary": "One paragraph in formal Spanish summarizing system health",
  "root_causes": ["array of root cause strings in formal Spanish"],
  "actions_taken": ["array of actions the autopilot took this run"],
  "recommended_next_steps": ["array of recommendations in formal Spanish"]
}

You are advisory only. You cannot modify data. The deterministic policy engine handles all mutations.`;

// ────────── Main handler ──────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine for scheduled mode
    }

    const mode = (body.mode as string) || "SCHEDULED";
    const orgIdOverride = body.organization_id as string | undefined;

    // ── Resolve organizations ──
    const orgIds = await resolveOrgIds(supabase, orgIdOverride);
    if (orgIds.length === 0) {
      return jsonResponse({ ok: true, message: "No organizations with monitored items", mode });
    }

    // Process first org (platform admin usually targets the default org)
    const orgId = orgIds[0];

    // ── Advisory lock: prevent overlap with scheduled-daily-sync ──
    let lockAcquired = true;
    if (mode === "SCHEDULED") {
      try {
        const { data: lockResult } = await supabase.rpc("run_sql", {
          sql: `SELECT pg_try_advisory_lock(hashtext('atenia_autopilot_' || '${orgId}')) AS acquired`,
        });
        // Fallback: if rpc doesn't exist, skip lock
        if (lockResult && Array.isArray(lockResult) && lockResult[0]?.acquired === false) {
          lockAcquired = false;
        }
      } catch {
        // If advisory lock RPC unavailable, proceed without lock
      }

      if (!lockAcquired) {
        console.log(`[autopilot] Advisory lock not acquired for org ${orgId}, skipping to avoid overlap`);
        return jsonResponse({ ok: true, message: "Skipped: concurrent sync running", mode, org_id: orgId });
      }
    }

    try {
    // ── Load config ──
    const config = await loadOrgConfig(supabase, orgId);

    // ── Build health snapshot ──
    const health = await buildHealthSnapshot(supabase, orgId, config);

    // ── Validate & self-heal ──
    const actionsTaken: ActionRecord[] = [];
    await validateAndHeal(supabase, orgId, config, health, actionsTaken);

    // ── Corrective syncs (scheduled mode only, capped) ──
    if (mode === "SCHEDULED" && !config.autonomy_paused) {
      await runCorrectiveSyncs(supabase, orgId, config, health, actionsTaken);
    }

    // ── Persist actions to atenia_ai_actions ──
    for (const action of actionsTaken) {
      try {
        await supabase.from("atenia_ai_actions").insert({
          organization_id: orgId,
          action_type: action.type,
          autonomy_tier: action.type === "CREATE_ALERT" ? "OBSERVE" : "ACT",
          reasoning: action.reason,
          target_entity_type: "WORK_ITEM",
          target_entity_id: action.work_item_id || null,
          action_taken: action.type,
          action_result: "SUCCESS",
          evidence: action.evidence,
        });
      } catch {
        // non-blocking
      }
    }

    const snapshot = {
      ok: true,
      now: new Date().toISOString(),
      org_id: orgId,
      mode,
      config: {
        auto_sync_cooldown_minutes: config.auto_sync_cooldown_minutes,
        max_auto_syncs_per_heartbeat: config.max_auto_syncs_per_heartbeat,
        auto_demonitor_after_404s: config.auto_demonitor_after_404s,
        provider_slow_threshold_ms: config.provider_slow_threshold_ms,
        provider_error_rate_threshold: config.provider_error_rate_threshold,
        autonomy_paused: config.autonomy_paused,
      },
      health,
      actions_taken: actionsTaken,
      gemini_system_prompt: mode === "ON_DEMAND" ? GEMINI_AUTOPILOT_SYSTEM_PROMPT : undefined,
      duration_ms: Date.now() - startTime,
    };

    return jsonResponse(snapshot);
    } finally {
      // Release advisory lock
      if (mode === "SCHEDULED" && lockAcquired) {
        try {
          await supabase.rpc("run_sql", {
            sql: `SELECT pg_advisory_unlock(hashtext('atenia_autopilot_' || '${orgId}'))`,
          });
        } catch {
          // best effort
        }
      }
    }
  } catch (error: any) {
    console.error("[autopilot] Fatal error:", error);
    return jsonResponse(
      { ok: false, error: error.message || String(error), duration_ms: Date.now() - startTime },
      500,
    );
  }
});

// ────────── Types ──────────

interface OrgConfig {
  auto_sync_cooldown_minutes: number;
  max_auto_syncs_per_heartbeat: number;
  auto_demonitor_after_404s: number;
  provider_slow_threshold_ms: number;
  provider_error_rate_threshold: number;
  autonomy_paused: boolean;
  gemini_enabled: boolean;
}

interface HealthSnapshot {
  provider_status: Record<
    string,
    { avg_latency_ms: number; error_rate: number; degraded: boolean; total_calls: number; errors: number }
  >;
  sync: {
    total_monitored: number;
    synced_today: number;
    skipped_today: number;
    failures_today: number;
    scraping_pending_today: number;
    transient_without_retry: number;
    empty_result_count: number;   // items with PROVIDER_EMPTY_RESULT in last 24h
    empty_result_rate: number;    // empty_result_count / total_monitored (0-100%)
  };
  retry_queue: {
    pending_count: number;
    due_count: number;
    oldest_due_at: string | null;
    by_kind: Record<string, number>;
  };
  demonitors: {
    eligible_count: number;
    blocked_breakdown: Record<string, number>;
    executed_count: number;
  };
  invariants: {
    violations: InvariantViolation[];
  };
}

interface InvariantViolation {
  code: string;
  severity: "WARNING" | "CRITICAL";
  message: string;
  work_item_id?: string;
  radicado?: string;
  evidence?: Record<string, unknown>;
}

interface ActionRecord {
  type: "ENQUEUE_RETRY" | "AUTO_DEMONITOR" | "CREATE_ALERT" | "TRIGGER_SYNC";
  work_item_id?: string;
  radicado?: string;
  reason: string;
  evidence: Record<string, unknown>;
}

// ────────── Helpers ──────────

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function resolveOrgIds(supabase: any, override?: string): Promise<string[]> {
  if (override) return [override];

  const { data } = await supabase
    .from("work_items")
    .select("organization_id")
    .eq("monitoring_enabled", true)
    .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
    .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
    .not("organization_id", "is", null);

  return [...new Set((data || []).map((d: any) => d.organization_id).filter(Boolean))] as string[];
}

async function loadOrgConfig(supabase: any, orgId: string): Promise<OrgConfig> {
  const { data } = await supabase
    .from("atenia_ai_config")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  return {
    auto_sync_cooldown_minutes: data?.auto_sync_cooldown_minutes ?? 30,
    max_auto_syncs_per_heartbeat: data?.max_auto_syncs_per_heartbeat ?? 5,
    auto_demonitor_after_404s: data?.auto_demonitor_after_404s ?? 5,
    provider_slow_threshold_ms: data?.provider_slow_threshold_ms ?? 5000,
    provider_error_rate_threshold: data?.provider_error_rate_threshold ?? 30,
    autonomy_paused: data?.autonomy_paused ?? false,
    gemini_enabled: data?.gemini_enabled ?? true,
  };
}

// ────────── Build Health Snapshot ──────────

async function buildHealthSnapshot(
  supabase: any,
  orgId: string,
  config: OrgConfig,
): Promise<HealthSnapshot> {
  const todayStr = getTodayCOT();

  // 1. Total monitored items
  const { count: totalMonitored } = await supabase
    .from("work_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
    .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`);

  // 2. Synced today (last_synced_at >= today start)
  const todayStart = `${todayStr}T00:00:00.000Z`;
  const { count: syncedToday } = await supabase
    .from("work_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .gte("last_synced_at", todayStart);

  // 3. Failures today
  const { count: failuresToday } = await supabase
    .from("work_items")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .gte("last_error_at", todayStart);

  // 4. Retry queue metrics
  const { data: retryRows } = await (supabase.from("sync_retry_queue") as any)
    .select("id, kind, next_run_at, organization_id")
    .eq("organization_id", orgId);

  const now = new Date().toISOString();
  const retryList = retryRows || [];
  const dueRows = retryList.filter((r: any) => r.next_run_at <= now);
  const byKind: Record<string, number> = {};
  for (const r of retryList) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  }
  const oldestDue = dueRows.length > 0
    ? dueRows.sort((a: any, b: any) => a.next_run_at.localeCompare(b.next_run_at))[0].next_run_at
    : null;

  // 5. Demonitor eligibility
  const threshold = config.auto_demonitor_after_404s;
  const { data: demonitorCandidates } = await supabase
    .from("work_items")
    .select("id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .gte("consecutive_404_count", threshold);

  const candidateIds = (demonitorCandidates || []).map((c: any) => c.id);
  let retryIdsForCandidates = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: retries } = await (supabase.from("sync_retry_queue") as any)
      .select("work_item_id")
      .in("work_item_id", candidateIds);
    retryIdsForCandidates = new Set((retries || []).map((r: any) => r.work_item_id));
  }

  const blockedBreakdown: Record<string, number> = {
    PENDING_RETRY: 0,
    TRANSIENT_ERROR: 0,
    RECENTLY_HEALTHY: 0,
  };
  let eligibleCount = 0;

  for (const item of demonitorCandidates || []) {
    const decision = shouldDemonitor(item, threshold, retryIdsForCandidates.has(item.id));
    if (decision.demonitor) {
      eligibleCount++;
    } else if (decision.blockedBy) {
      for (const b of decision.blockedBy) {
        blockedBreakdown[b] = (blockedBreakdown[b] || 0) + 1;
      }
    }
  }

  // 6. Provider health from recent sync_traces (last 2 hours)
  //    IMPORTANT: Only count terminal step rows to avoid double-counting intermediate stages per run.
  //    Terminal steps: DB_WRITE_RESULT, SYNC_COMPLETE, DONE, ERROR (final), EMPTY_RESULT
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: traces } = await supabase
    .from("sync_traces")
    .select("trace_id, provider, latency_ms, error_code, step, created_at")
    .eq("organization_id", orgId)
    .gte("created_at", twoHoursAgo)
    .in("step", ["DB_WRITE_RESULT", "SYNC_COMPLETE", "DONE", "EMPTY_RESULT"])
    .limit(500);

  const providerStatus: HealthSnapshot["provider_status"] = {};
  // Deduplicate by trace_id to ensure one count per sync run
  const seenTraceIds = new Set<string>();
  const providerGroups: Record<string, { latencies: number[]; errors: number; total: number }> = {};
  for (const t of traces || []) {
    const traceKey = t.trace_id || t.id;
    if (seenTraceIds.has(traceKey)) continue;
    seenTraceIds.add(traceKey);
    const p = t.provider || "unknown";
    if (!providerGroups[p]) providerGroups[p] = { latencies: [], errors: 0, total: 0 };
    providerGroups[p].total++;
    if (t.latency_ms) providerGroups[p].latencies.push(t.latency_ms);
    if (t.error_code) providerGroups[p].errors++;
  }
  for (const [p, g] of Object.entries(providerGroups)) {
    const avgLatency = g.latencies.length > 0
      ? Math.round(g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length)
      : 0;
    const errorRate = g.total > 0 ? Math.round((g.errors / g.total) * 100) : 0;
    const degraded =
      avgLatency > config.provider_slow_threshold_ms ||
      errorRate > config.provider_error_rate_threshold;
    providerStatus[p] = {
      avg_latency_ms: avgLatency,
      error_rate: errorRate,
      degraded,
      total_calls: g.total,
      errors: g.errors,
    };
  }

  // 7. Invariant violations — detect anomalies
  const violations: InvariantViolation[] = [];

  // Check for items where scraping was treated as success (last_synced_at updated on scraping_pending)
  // Heuristic: items with transient error code but last_synced_at updated today
  const { data: suspiciousItems } = await supabase
    .from("work_items")
    .select("id, radicado, last_synced_at, last_error_code, scrape_status")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .gte("last_synced_at", todayStart)
    .in("last_error_code", [...TRANSIENT_ERROR_CODES]);

  for (const item of suspiciousItems || []) {
    violations.push({
      code: "SCRAPING_TREATED_AS_SUCCESS",
      severity: "CRITICAL",
      message: `Item ${item.radicado} has last_synced_at=${item.last_synced_at} but last_error_code=${item.last_error_code} (transient). Possible invariant violation.`,
      work_item_id: item.id,
      radicado: item.radicado,
      evidence: {
        last_synced_at: item.last_synced_at,
        last_error_code: item.last_error_code,
        scrape_status: item.scrape_status,
      },
    });
  }

  // Check for demonitored items that should have been blocked
  const { data: recentDemonitors } = await supabase
    .from("work_items")
    .select("id, radicado, demonitor_at, demonitor_reason, last_error_code, last_synced_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", false)
    .not("demonitor_at", "is", null)
    .gte("demonitor_at", todayStart);

  for (const item of recentDemonitors || []) {
    // Check if last_error_code is not a 404-type
    if (
      item.last_error_code &&
      !(DEMONITOR_ELIGIBLE_ERROR_CODES as readonly string[]).includes(item.last_error_code)
    ) {
      violations.push({
        code: "DEMONITOR_WITHOUT_404",
        severity: "CRITICAL",
        message: `Item ${item.radicado} was demonitored today but last_error_code=${item.last_error_code} is not a 404-type signal.`,
        work_item_id: item.id,
        radicado: item.radicado,
        evidence: {
          demonitor_at: item.demonitor_at,
          last_error_code: item.last_error_code,
          last_synced_at: item.last_synced_at,
        },
      });
    }
  }

  const skippedToday = (totalMonitored || 0) - (syncedToday || 0) - (failuresToday || 0);

  // 8. Transient-pending-without-retry counter (should be ~0 if autopilot is healthy)
  // Items that have a transient error code but NO retry row — indicates a gap in self-healing
  const { data: transientNoRetryItems } = await supabase
    .from("work_items")
    .select("id")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .in("last_error_code", [...TRANSIENT_ERROR_CODES]);

  let transientWithoutRetryCount = 0;
  if (transientNoRetryItems && transientNoRetryItems.length > 0) {
    const tIds = transientNoRetryItems.map((t: any) => t.id);
    const { data: existingRetriesForTransient } = await (supabase.from("sync_retry_queue") as any)
      .select("work_item_id")
      .in("work_item_id", tIds);
    const retrySetTransient = new Set((existingRetriesForTransient || []).map((r: any) => r.work_item_id));
    transientWithoutRetryCount = tIds.filter((id: string) => !retrySetTransient.has(id)).length;
  }

  // 9. Empty result rate (last 24h) — detect provider coverage gaps vs ingestion bugs
  //    Count distinct trace_ids to avoid inflating rate with multi-step traces
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: emptyTraces } = await supabase
    .from("sync_traces")
    .select("trace_id")
    .eq("organization_id", orgId)
    .eq("error_code", "PROVIDER_EMPTY_RESULT")
    .gte("created_at", twentyFourHoursAgo)
    .limit(500);
  const uniqueEmptyTraceIds = new Set((emptyTraces || []).map((t: any) => t.trace_id));
  const emptyResultCountFinal = uniqueEmptyTraceIds.size;

  const emptyCount = emptyResultCountFinal;
  const emptyRate = (totalMonitored || 0) > 0
    ? Math.round((emptyCount / (totalMonitored || 1)) * 100)
    : 0;

  return {
    provider_status: providerStatus,
    sync: {
      total_monitored: totalMonitored || 0,
      synced_today: syncedToday || 0,
      skipped_today: skippedToday > 0 ? skippedToday : 0,
      failures_today: failuresToday || 0,
      scraping_pending_today: retryList.filter((r: any) => r.kind === "ACT_SCRAPE_RETRY").length,
      transient_without_retry: transientWithoutRetryCount,
      empty_result_count: emptyCount,
      empty_result_rate: emptyRate,
    },
    retry_queue: {
      pending_count: retryList.length,
      due_count: dueRows.length,
      oldest_due_at: oldestDue,
      by_kind: byKind,
    },
    demonitors: {
      eligible_count: eligibleCount,
      blocked_breakdown: blockedBreakdown,
      executed_count: 0, // will be updated by validateAndHeal
    },
    invariants: { violations },
  };
}

// ────────── Validate & Self-Heal ──────────

async function validateAndHeal(
  supabase: any,
  orgId: string,
  config: OrgConfig,
  health: HealthSnapshot,
  actions: ActionRecord[],
) {
  // (a) Ensure retry rows exist for items with transient errors and no retry row
  const { data: transientItems } = await supabase
    .from("work_items")
    .select("id, radicado, last_error_code, workflow_type")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .in("last_error_code", [...TRANSIENT_ERROR_CODES]);

  if (transientItems && transientItems.length > 0) {
    const transientIds = transientItems.map((t: any) => t.id);
    const { data: existingRetries } = await (supabase.from("sync_retry_queue") as any)
      .select("work_item_id")
      .in("work_item_id", transientIds)
      .eq("kind", "ACT_SCRAPE_RETRY");

    const retrySet = new Set((existingRetries || []).map((r: any) => r.work_item_id));

    for (const item of transientItems) {
      if (!retrySet.has(item.id)) {
        const nextRunAt = new Date(Date.now() + retryJitterMs()).toISOString();
        try {
          await (supabase.from("sync_retry_queue") as any).insert({
            work_item_id: item.id,
            organization_id: orgId,
            radicado: item.radicado,
            workflow_type: item.workflow_type,
            kind: "ACT_SCRAPE_RETRY",
            provider: "cpnu",
            attempt: 1,
            max_attempts: 3,
            next_run_at: nextRunAt,
            last_error_code: item.last_error_code,
            last_error_message: "Enqueued by autopilot: missing retry row for transient error",
          });
          actions.push({
            type: "ENQUEUE_RETRY",
            work_item_id: item.id,
            radicado: item.radicado,
            reason: `Missing retry row for transient error ${item.last_error_code}`,
            evidence: buildAuditEvidence({
              item,
              retryRowPresent: false,
              extra: { healed_by: "autopilot" },
            }),
          });
        } catch {
          // non-blocking
        }
      }
    }
  }

  // (b) Execute auto-demonitor for eligible items
  if (health.demonitors.eligible_count > 0 && config.auto_demonitor_after_404s > 0) {
    const threshold = config.auto_demonitor_after_404s;
    const { data: demonitorCandidates } = await supabase
      .from("work_items")
      .select("id, radicado, consecutive_404_count, consecutive_failures, last_error_code, last_synced_at")
      .eq("organization_id", orgId)
      .eq("monitoring_enabled", true)
      .gte("consecutive_404_count", threshold);

    if (demonitorCandidates && demonitorCandidates.length > 0) {
      const candIds = demonitorCandidates.map((c: any) => c.id);
      const { data: retries } = await (supabase.from("sync_retry_queue") as any)
        .select("work_item_id")
        .in("work_item_id", candIds);
      const retrySet = new Set((retries || []).map((r: any) => r.work_item_id));

      const toDemons = demonitorCandidates.filter((item: any) => {
        const decision = shouldDemonitor(item, threshold, retrySet.has(item.id));
        return decision.demonitor;
      });

      if (toDemons.length > 0) {
        const demonIds = toDemons.map((d: any) => d.id);
        const now = new Date().toISOString();
        await supabase
          .from("work_items")
          .update({
            monitoring_enabled: false,
            demonitor_reason: `Auto-demonitored by autopilot: ${threshold}+ consecutive 404/stuck errors`,
            demonitor_at: now,
          })
          .in("id", demonIds);

        health.demonitors.executed_count = toDemons.length;

        for (const item of toDemons.slice(0, 10)) {
          actions.push({
            type: "AUTO_DEMONITOR",
            work_item_id: item.id,
            radicado: item.radicado,
            reason: `${item.consecutive_404_count} consecutive 404/stuck errors (threshold: ${threshold}). Monitoring suspended.`,
            evidence: buildAuditEvidence({
              item,
              retryRowPresent: retrySet.has(item.id),
              threshold,
            }),
          });
        }

        console.log(`[autopilot] Auto-demonitored ${toDemons.length} items: ${toDemons.map((d: any) => d.radicado).join(', ')}`);
      }
    }
  }

  // (c) Create alerts for invariant violations
  for (const v of health.invariants.violations) {
    try {
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", orgId)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();

      if (membership?.user_id) {
        const todayStr = getTodayCOT();
        await supabase.from("alert_instances").insert({
          owner_id: membership.user_id,
          organization_id: orgId,
          entity_type: "SYSTEM",
          entity_id: v.work_item_id || orgId,
          severity: v.severity === "CRITICAL" ? "CRITICAL" : "WARNING",
          status: "PENDING",
          title: `Invariant Violation: ${v.code}`,
          message: v.message,
          fingerprint: `autopilot_${v.code}_${v.work_item_id || orgId}_${todayStr}`,
          payload: v.evidence || {},
        });

        actions.push({
          type: "CREATE_ALERT",
          work_item_id: v.work_item_id,
          radicado: v.radicado,
          reason: v.message,
          evidence: v.evidence || {},
        });
      }
    } catch {
      // non-blocking
    }
  }
}

// ────────── Corrective Syncs ──────────

async function runCorrectiveSyncs(
  supabase: any,
  orgId: string,
  config: OrgConfig,
  health: HealthSnapshot,
  actions: ActionRecord[],
) {
  // Check provider degradation — reduce max if degraded
  const anyDegraded = Object.values(health.provider_status).some((p) => p.degraded);
  const maxSyncs = anyDegraded
    ? Math.max(1, Math.floor(config.max_auto_syncs_per_heartbeat / 2))
    : config.max_auto_syncs_per_heartbeat;

  // Get items that need corrective sync (oldest last_synced_at, not in retry queue)
  const { data: candidates } = await supabase
    .from("work_items")
    .select("id, radicado, workflow_type, last_synced_at")
    .eq("organization_id", orgId)
    .eq("monitoring_enabled", true)
    .in("workflow_type", [...SYNC_ENABLED_WORKFLOWS])
    .not("stage", "in", `(${[...TERMINAL_STAGES].join(",")})`)
    .not("radicado", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(maxSyncs * 2);

  if (!candidates || candidates.length === 0) return;

  // Exclude items already in retry queue
  const candIds = candidates.map((c: any) => c.id);
  const { data: retrying } = await (supabase.from("sync_retry_queue") as any)
    .select("work_item_id")
    .in("work_item_id", candIds);
  const retryingSet = new Set((retrying || []).map((r: any) => r.work_item_id));
  const toSync = candidates.filter((c: any) => !retryingSet.has(c.id)).slice(0, maxSyncs);

  for (const item of toSync) {
    // Time guard
    if (Date.now() % 60000 > 48000) break; // crude guard within minute

    try {
      const { data: syncResult } = await supabase.functions.invoke("sync-by-work-item", {
        body: { work_item_id: item.id, _scheduled: true },
      });

      if (syncResult?.ok === true) {
        actions.push({
          type: "TRIGGER_SYNC",
          work_item_id: item.id,
          radicado: item.radicado,
          reason: `Corrective sync succeeded (inserted=${syncResult.inserted_count || 0})`,
          evidence: { ok: true, inserted_count: syncResult.inserted_count },
        });
      } else if (syncResult?.scraping_initiated) {
        // Ensure retry row
        const { data: existing } = await (supabase.from("sync_retry_queue") as any)
          .select("id")
          .eq("work_item_id", item.id)
          .eq("kind", "ACT_SCRAPE_RETRY")
          .maybeSingle();

        if (!existing) {
          await (supabase.from("sync_retry_queue") as any).insert({
            work_item_id: item.id,
            organization_id: orgId,
            radicado: item.radicado,
            workflow_type: item.workflow_type,
            kind: "ACT_SCRAPE_RETRY",
            provider: syncResult.scraping_provider || "cpnu",
            attempt: 1,
            max_attempts: 3,
            next_run_at: new Date(Date.now() + retryJitterMs()).toISOString(),
            last_error_code: "SCRAPING_TIMEOUT",
            last_error_message: "Enqueued by autopilot corrective sync",
            scraping_job_id: syncResult.scraping_job_id || null,
          });
        }
        actions.push({
          type: "ENQUEUE_RETRY",
          work_item_id: item.id,
          radicado: item.radicado,
          reason: "Corrective sync returned scraping_initiated, retry enqueued",
          evidence: { scraping_job_id: syncResult.scraping_job_id },
        });
      }

      // Backoff between items
      await new Promise((r) => setTimeout(r, anyDegraded ? 3000 : 1500));
    } catch {
      // non-blocking
    }
  }
}

function getTodayCOT(): string {
  const now = new Date();
  const cot = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cot.toISOString().slice(0, 10);
}
