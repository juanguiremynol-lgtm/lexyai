/**
 * syncOrchestrator.ts — Single source of truth for external API sync execution.
 *
 * This module is the ONLY place that decides:
 *   1. Which providers to call for a work item (via providerCoverageMatrix.ts)
 *   2. Execution mode: CHAIN (primary→fallback) vs FANOUT (parallel all)
 *   3. Per-provider timeouts, retries, circuit breaker awareness
 *   4. Dedupe / idempotency via fingerprint + ON CONFLICT
 *   5. Recording external_sync_runs for observability (per-attempt rows)
 *
 * All call sites (sync-by-work-item, sync-by-radicado, scheduled-daily-sync)
 * MUST use this orchestrator instead of calling provider clients directly.
 *
 * Demo modal (demo-radicado-lookup) is EXCLUDED by design:
 *   - Zero-auth, zero-DB-write, writes to demo_radicado_cache only
 *   - Has its own PROVIDER_REGISTRY with PII redaction
 *
 * Execution modes:
 *   CHAIN: Sequential primary → fallback. Stops on first success.
 *          Used for: CGP, LABORAL, CPACA, PENAL_906
 *   FANOUT: Parallel calls to ALL providers, merge results with dedup.
 *          Used for: TUTELA (info can be anywhere)
 *          Concurrency limited to FANOUT_CONCURRENCY (default 2).
 *
 * Fallback rules (CHAIN mode only):
 *   - CGP/LABORAL: NO fallback for actuaciones (CPNU only).
 *   - CPACA: NO fallback for actuaciones (SAMAI only).
 *   - PENAL_906: CPNU primary, fallback to SAMAI.
 *   - Fallback triggers ONLY on NOT_FOUND (no match at all).
 *   - FOUND_PARTIAL does NOT trigger fallback.
 */

import {
  getProviderCoverage,
  getProviderCoverageWithOverrides,
  loadCoverageOverrides,
  type CoverageOverrideRow,
  type DataKind,
  type ProviderEntry,
  type ExecutionMode,
} from "./providerCoverageMatrix.ts";
import {
  createDynamicProviderAdapter,
  type DynamicProviderConfig,
} from "./genericRemoteAdapter.ts";
import {
  determineFoundStatus,
  shouldTriggerFallback,
  type FoundStatus,
} from "./providerStrategy.ts";

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export type InvokedBy =
  | "DEMO"
  | "WIZARD"
  | "CRON"
  | "MANUAL"
  | "RETRY"
  | "HEARTBEAT"
  | "E2E_TEST"
  | "GHOST_VERIFY";

export interface SyncRunContext {
  workItemId: string;
  organizationId: string | null;
  workflowType: string;
  radicado: string;
  invokedBy: InvokedBy;
  triggerSource: string; // e.g. 'sync-by-work-item', 'scheduled-daily-sync'
}

export interface ProviderAttemptResult {
  provider: string;
  data_kind: DataKind;
  role: "PRIMARY" | "FALLBACK";
  status: "success" | "not_found" | "empty" | "error" | "timeout" | "skipped";
  http_code: number | null;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  inserted_count: number;
  skipped_count: number;
  /** Adapter-provided metadata (e.g. _legacyResult for post-processing) */
  metadata?: Record<string, unknown>;
}

export interface SyncRunResult {
  syncRunId: string | null;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "TIMEOUT";
  totalInsertedActs: number;
  totalSkippedActs: number;
  totalInsertedPubs: number;
  totalSkippedPubs: number;
  providerAttempts: ProviderAttemptResult[];
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  foundStatus: FoundStatus;
}

/**
 * Provider fetch function signature.
 * Each provider adapter must implement this interface.
 * Returns the raw fetch result with inserted/skipped counts.
 */
export interface ProviderFetchFn {
  (params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{
    ok: boolean;
    found: boolean;
    isEmpty: boolean;
    insertedCount: number;
    skippedCount: number;
    httpStatus: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    latencyMs: number;
    metadata?: Record<string, unknown>;
  }>;
}

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

/** Default per-provider timeout in ms (used only if no provider-specific timeout is set) */
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

/**
 * Per-provider timeout budgets in ms.
 * Based on observed p95 latencies and provider async models:
 *   - CPNU: scrape-based, usually fast (20-30s)
 *   - PUBLICACIONES: REST API, fast (15-25s)
 *   - SAMAI: async job model, can be slow (60-120s)
 *   - SAMAI_ESTADOS: similar to SAMAI
 *   - TUTELAS: fire-and-forget + poll, can be very slow (60-90s)
 */
const PROVIDER_TIMEOUT_MS: Record<string, number> = {
  CPNU: 30_000,
  PUBLICACIONES: 25_000,
  SAMAI: 90_000,
  SAMAI_ESTADOS: 90_000,
  TUTELAS: 90_000,
};

/** Get timeout for a specific provider, falling back to default.
 *  Also checks dynamic overrides if provided. */
export function getProviderTimeout(providerKey: string, overrides?: CoverageOverrideRow[]): number {
  // Check dynamic overrides first
  if (overrides) {
    const override = overrides.find((o) => o.provider_key.toUpperCase() === providerKey.toUpperCase() && o.timeout_ms);
    if (override?.timeout_ms) return override.timeout_ms;
  }
  return PROVIDER_TIMEOUT_MS[providerKey] || DEFAULT_PROVIDER_TIMEOUT_MS;
}

/** Max providers to attempt per data kind before stopping (CHAIN mode) */
const MAX_ATTEMPTS_PER_KIND = 3;

/** Max concurrent provider calls in FANOUT mode */
const FANOUT_CONCURRENCY = 2;

// ═══════════════════════════════════════════
// SYNC RUN RECORDER
// ═══════════════════════════════════════════

/**
 * Create a sync run record at the start of orchestration.
 * Returns the run ID for later update.
 */
async function createSyncRun(
  supabase: any,
  ctx: SyncRunContext,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("external_sync_runs")
      .insert({
        work_item_id: ctx.workItemId,
        organization_id: ctx.organizationId,
        invoked_by: ctx.invokedBy,
        trigger_source: ctx.triggerSource,
        started_at: new Date().toISOString(),
        status: "RUNNING",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[syncOrchestrator] Failed to create sync run:", error.message);
      return null;
    }
    return data.id;
  } catch {
    return null;
  }
}

/**
 * Finalize a sync run record with results.
 */
async function finalizeSyncRun(
  supabase: any,
  runId: string | null,
  result: SyncRunResult,
): Promise<void> {
  if (!runId) return;
  try {
    await supabase
      .from("external_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duration_ms: result.durationMs,
        status: result.status,
        provider_attempts: result.providerAttempts,
        total_inserted_acts: result.totalInsertedActs,
        total_skipped_acts: result.totalSkippedActs,
        total_inserted_pubs: result.totalInsertedPubs,
        total_skipped_pubs: result.totalSkippedPubs,
        error_code: result.errorCode,
        error_message: result.errorMessage,
        retry_count: 0,
      })
      .eq("id", runId);
  } catch {
    // Best-effort — never break main flow
  }
}

// ═══════════════════════════════════════════
// ORCHESTRATION ENGINE
// ═══════════════════════════════════════════

/**
 * Execute a sync chain for a single data kind (ACTUACIONES or ESTADOS).
 *
 * Follows the provider coverage matrix:
 *   1. Try all PRIMARY providers in order
 *   2. If ALL primaries return NOT_FOUND, try FALLBACK providers
 *   3. Stop on first success or FOUND_PARTIAL
 *   4. Record each attempt
 *
 * @param providers - Ordered list from getProviderCoverage()
 * @param fetchFnRegistry - Map of provider key → fetch function
 * @param params - Common params for all providers
 * @returns Aggregated results for this data kind
 */
export async function executeSyncChain(
  dataKind: DataKind,
  providers: ProviderEntry[],
  fetchFnRegistry: Map<string, ProviderFetchFn>,
  params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Internal: sync run ID for per-attempt recording */
    _syncRunId?: string | null;
    /** Internal: organization ID for canary-scoped test hooks */
    _organizationId?: string;
  },
): Promise<{
  attempts: ProviderAttemptResult[];
  totalInserted: number;
  totalSkipped: number;
  foundStatus: FoundStatus;
}> {
  const attempts: ProviderAttemptResult[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let hasMetadataMatch = false;
  let hasData = false;
  let allFailed = true;
  let attemptCount = 0;

  const primaries = providers.filter((p) => p.role === "PRIMARY");
  const fallbacks = providers.filter((p) => p.role === "FALLBACK");

  // Phase 1: Primary providers
  for (const provider of primaries) {
    if (attemptCount >= MAX_ATTEMPTS_PER_KIND) break;
    if (params.signal?.aborted) break;

    const fetchFn = fetchFnRegistry.get(provider.key);
    if (!fetchFn) {
      const skippedAttempt: ProviderAttemptResult = {
        provider: provider.key,
        data_kind: dataKind,
        role: "PRIMARY",
        status: "skipped",
        http_code: null,
        latency_ms: 0,
        error_code: "NO_FETCH_FN",
        error_message: `No fetch function registered for provider ${provider.key}`,
        inserted_count: 0,
        skipped_count: 0,
      };
      attempts.push(skippedAttempt);
      continue;
    }

    attemptCount++;
    const result = await safeProviderFetch(fetchFn, provider, "PRIMARY", dataKind, params);
    // Record per-attempt row (non-blocking)
    if (params._syncRunId) {
      recordProviderAttempt(params.supabase, params._syncRunId, result);
    }
    attempts.push(result);

    if (result.status === "success") {
      totalInserted += result.inserted_count;
      totalSkipped += result.skipped_count;
      hasData = true;
      hasMetadataMatch = true;
      allFailed = false;
      break; // Primary succeeded, no need for more primaries
    }

    if (result.status === "empty" || result.status === "not_found") {
      allFailed = false; // API responded, just no data
    }
  }

  // Phase 2: Fallback providers (only if primary returned NOT_FOUND)
  const primaryStatus = determineFoundStatus(hasMetadataMatch, hasData, allFailed);
  if (shouldTriggerFallback(primaryStatus) && fallbacks.length > 0) {
    for (const provider of fallbacks) {
      if (attemptCount >= MAX_ATTEMPTS_PER_KIND) break;
      if (params.signal?.aborted) break;

      const fetchFn = fetchFnRegistry.get(provider.key);
      if (!fetchFn) {
        attempts.push({
          provider: provider.key,
          data_kind: dataKind,
          role: "FALLBACK",
          status: "skipped",
          http_code: null,
          latency_ms: 0,
          error_code: "NO_FETCH_FN",
          error_message: `No fetch function registered for provider ${provider.key}`,
          inserted_count: 0,
          skipped_count: 0,
        });
        continue;
      }

      attemptCount++;
      const result = await safeProviderFetch(fetchFn, provider, "FALLBACK", dataKind, params);
      // Record per-attempt row (non-blocking)
      if (params._syncRunId) {
        recordProviderAttempt(params.supabase, params._syncRunId, result);
      }
      attempts.push(result);

      if (result.status === "success") {
        totalInserted += result.inserted_count;
        totalSkipped += result.skipped_count;
        hasData = true;
        hasMetadataMatch = true;
        break;
      }
    }
  }

  const foundStatus = determineFoundStatus(
    hasMetadataMatch || attempts.some((a) => a.status !== "error" && a.status !== "timeout"),
    hasData,
    attempts.every((a) => a.status === "error" || a.status === "timeout"),
  );

  return { attempts, totalInserted, totalSkipped, foundStatus };
}

/**
 * Safe wrapper around a provider fetch function.
 * Handles timeouts, errors, and normalizes results.
 */
async function safeProviderFetch(
  fetchFn: ProviderFetchFn,
  provider: ProviderEntry,
  role: "PRIMARY" | "FALLBACK",
  dataKind: DataKind,
  params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    _organizationId?: string;
  },
): Promise<ProviderAttemptResult> {
  // ── FORCED TIMEOUT TEST HOOK (canary-scoped) ──────────────────────
  // Env vars: FORCE_PROVIDER_TIMEOUT=true, FORCE_PROVIDER_TIMEOUT_PROVIDER=SAMAI_ESTADOS,
  //           FORCE_PROVIDER_TIMEOUT_ORGS= SELF | slug | org-uuid-1,org-uuid-2
  //
  // SELF  → uses params._organizationId from the current invocation (no UUID needed)
  // slug  → non-UUID string resolved via organizations.slug or name
  // UUID  → comma-separated allowlist (original behavior)
  //
  // Safety: if org cannot be resolved, forced timeout is NEVER activated.
  const forceTimeout = Deno.env.get("FORCE_PROVIDER_TIMEOUT") === "true";
  const forceProvider = (Deno.env.get("FORCE_PROVIDER_TIMEOUT_PROVIDER") ?? "").toUpperCase();
  const forceOrgsRaw = (Deno.env.get("FORCE_PROVIDER_TIMEOUT_ORGS") ?? "").trim();
  const orgId = params._organizationId ?? "";

  if (forceTimeout && forceProvider === provider.key.toUpperCase() && forceOrgsRaw && orgId) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let orgMatches = false;

    if (forceOrgsRaw.toUpperCase() === "SELF") {
      // SELF mode: always matches the current invocation's org
      orgMatches = true;
    } else if (!UUID_RE.test(forceOrgsRaw.split(",")[0]?.trim() ?? "")) {
      // Slug mode: resolve slug → UUID via DB (best-effort, fail-safe)
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
        const adminClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const slug = forceOrgsRaw.trim();
        const { data: orgRow } = await adminClient
          .from("organizations")
          .select("id")
          .or(`slug.ilike.${slug},name.ilike.${slug}`)
          .limit(1)
          .maybeSingle();
        if (orgRow?.id && orgRow.id === orgId) {
          orgMatches = true;
        }
      } catch (e) {
        console.warn(`[FORCED_TIMEOUT] Slug resolution failed, skipping forced timeout: ${e}`);
      }
    } else {
      // UUID list mode (original behavior)
      const forceOrgsList = forceOrgsRaw.split(",").map(s => s.trim()).filter(Boolean);
      orgMatches = forceOrgsList.includes(orgId);
    }

    if (orgMatches) {
      const budget = params.timeoutMs || getProviderTimeout(provider.key);
      console.warn(
        `[FORCED_TIMEOUT] Activated: provider=${provider.key} org=${orgId} budget=${budget}ms ` +
        `mode=${forceOrgsRaw.toUpperCase() === "SELF" ? "SELF" : UUID_RE.test(forceOrgsRaw.split(",")[0]?.trim() ?? "") ? "UUID" : "SLUG"} ` +
        `path=${params.workItemId ? "sync-by-work-item" : "wizard"}`
      );
      await new Promise(r => setTimeout(r, budget + 5_000));
      return {
        provider: provider.key,
        data_kind: dataKind,
        role,
        status: "timeout",
        http_code: null,
        latency_ms: budget + 5_000,
        error_code: "FORCED_TIMEOUT",
        error_message: `Forced timeout for release-gate testing (provider=${provider.key})`,
        inserted_count: 0,
        skipped_count: 0,
      };
    }
  }
  // ── END FORCED TIMEOUT TEST HOOK ──────────────────────────────────

  const timeoutMs = params.timeoutMs || getProviderTimeout(provider.key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose abort signals (external + timeout)
  const combinedSignal = params.signal
    ? composeAbortSignals(params.signal, controller.signal)
    : controller.signal;

  try {
    const result = await fetchFn({
      radicado: params.radicado,
      workItemId: params.workItemId,
      supabase: params.supabase,
      supabaseUrl: params.supabaseUrl,
      authHeader: params.authHeader,
      timeoutMs,
      signal: combinedSignal,
    });

    clearTimeout(timer);

    let status: ProviderAttemptResult["status"];
    if (result.ok && !result.isEmpty) status = "success";
    else if (result.isEmpty) status = "empty";
    else if (!result.found) status = "not_found";
    else status = "error";

    return {
      provider: provider.key,
      data_kind: dataKind,
      role,
      status,
      http_code: result.httpStatus,
      latency_ms: result.latencyMs,
      error_code: result.errorCode,
      error_message: result.errorMessage,
      inserted_count: result.insertedCount,
      skipped_count: result.skippedCount,
      metadata: result.metadata,
    };
  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err.name === "AbortError" || controller.signal.aborted;

    return {
      provider: provider.key,
      data_kind: dataKind,
      role,
      status: isTimeout ? "timeout" : "error",
      http_code: null,
      latency_ms: 0,
      error_code: isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR",
      error_message: (err.message || String(err)).slice(0, 500),
      inserted_count: 0,
      skipped_count: 0,
    };
  }
}

/**
 * Compose two AbortSignals into one that fires when either fires.
 */
function composeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

// ═══════════════════════════════════════════
// FANOUT EXECUTION ENGINE
// ═══════════════════════════════════════════

/**
 * Concurrency-limited parallel executor.
 * Runs at most `limit` promises concurrently.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  const executing = new Set<Promise<void>>();

  for (const task of tasks) {
    const p = task().then((r) => {
      results.push(r);
      executing.delete(p);
    });
    executing.add(p);
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}

/**
 * Execute a FANOUT sync: call ALL providers in parallel (concurrency-limited),
 * merge results, deduplicate at DB level via ON CONFLICT.
 *
 * Used for TUTELA where info can be anywhere across providers.
 * All providers are treated as PRIMARY — no fallback semantics.
 */
export async function executeSyncFanout(
  dataKind: DataKind,
  providers: ProviderEntry[],
  fetchFnRegistry: Map<string, ProviderFetchFn>,
  params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    _syncRunId?: string | null;
    _organizationId?: string;
  },
): Promise<{
  attempts: ProviderAttemptResult[];
  totalInserted: number;
  totalSkipped: number;
  foundStatus: FoundStatus;
}> {
  const tasks = providers
    .filter((p) => fetchFnRegistry.has(p.key))
    .map((provider) => async () => {
      const result = await safeProviderFetch(
        fetchFnRegistry.get(provider.key)!,
        provider,
        "PRIMARY", // All providers are primary in FANOUT
        dataKind,
        params,
      );
      // Record per-attempt row (non-blocking)
      if (params._syncRunId) {
        recordProviderAttempt(params.supabase, params._syncRunId, result);
      }
      return result;
    });

  // Add skipped entries for providers without fetch functions
  const skipped: ProviderAttemptResult[] = providers
    .filter((p) => !fetchFnRegistry.has(p.key))
    .map((p) => ({
      provider: p.key,
      data_kind: dataKind,
      role: "PRIMARY" as const,
      status: "skipped" as const,
      http_code: null,
      latency_ms: 0,
      error_code: "NO_FETCH_FN",
      error_message: `No fetch function registered for provider ${p.key}`,
      inserted_count: 0,
      skipped_count: 0,
    }));

  // Execute with concurrency limit
  const results = await runWithConcurrency(tasks, FANOUT_CONCURRENCY);

  const attempts = [...skipped, ...results];
  const totalInserted = attempts.reduce((s, a) => s + a.inserted_count, 0);
  const totalSkipped = attempts.reduce((s, a) => s + a.skipped_count, 0);

  const hasData = attempts.some((a) => a.status === "success");
  const hasMetadata = attempts.some(
    (a) => a.status !== "error" && a.status !== "timeout" && a.status !== "skipped",
  );
  const allFailed = attempts.every(
    (a) => a.status === "error" || a.status === "timeout" || a.status === "skipped",
  );

  const foundStatus = determineFoundStatus(hasMetadata, hasData, allFailed);

  return { attempts, totalInserted, totalSkipped, foundStatus };
}

// ═══════════════════════════════════════════
// PER-ATTEMPT RECORDING
// ═══════════════════════════════════════════

/**
 * Record a single provider attempt as a child row of a sync run.
 * Called by executeProviderAttempt() wrapper.
 * Non-blocking, best-effort.
 */
async function recordProviderAttempt(
  supabase: any,
  syncRunId: string | null,
  attempt: ProviderAttemptResult,
): Promise<void> {
  if (!syncRunId) return;
  try {
    await supabase
      .from("external_sync_run_attempts")
      .insert({
        sync_run_id: syncRunId,
        provider: attempt.provider,
        data_kind: attempt.data_kind,
        role: attempt.role,
        status: attempt.status,
        http_code: attempt.http_code,
        latency_ms: attempt.latency_ms,
        error_code: attempt.error_code,
        error_message: attempt.error_message?.slice(0, 500),
        inserted_count: attempt.inserted_count,
        skipped_count: attempt.skipped_count,
        recorded_at: new Date().toISOString(),
      });
  } catch {
    // Best-effort — never break main flow
  }
}

/**
 * Wrapper that executes a provider call and records the attempt.
 * This is the canonical way to call a provider — ensures every attempt
 * is persisted for observability regardless of outcome.
 */
export async function executeProviderAttempt(
  syncRunId: string | null,
  fetchFn: ProviderFetchFn,
  provider: ProviderEntry,
  role: "PRIMARY" | "FALLBACK",
  dataKind: DataKind,
  params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    _organizationId?: string;
  },
): Promise<ProviderAttemptResult> {
  const result = await safeProviderFetch(fetchFn, provider, role, dataKind, params);
  // Record attempt (non-blocking)
  recordProviderAttempt(params.supabase, syncRunId, result);
  return result;
}

// ═══════════════════════════════════════════
// DISPATCH: CHAIN vs FANOUT
// ═══════════════════════════════════════════

/**
 * Execute sync for a single data kind using the correct execution mode.
 * Dispatches to executeSyncChain or executeSyncFanout based on coverage matrix.
 */
export async function executeSync(
  dataKind: DataKind,
  executionMode: ExecutionMode,
  providers: ProviderEntry[],
  fetchFnRegistry: Map<string, ProviderFetchFn>,
  params: {
    radicado: string;
    workItemId: string;
    supabase: any;
    supabaseUrl: string;
    authHeader: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    _syncRunId?: string | null;
    _organizationId?: string;
  },
): Promise<{
  attempts: ProviderAttemptResult[];
  totalInserted: number;
  totalSkipped: number;
  foundStatus: FoundStatus;
}> {
  if (executionMode === "FANOUT") {
    return executeSyncFanout(dataKind, providers, fetchFnRegistry, params);
  }
  return executeSyncChain(dataKind, providers, fetchFnRegistry, params);
}

// ═══════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════

/**
 * Full sync orchestration for a work item.
 *
 * This is the top-level entry point that all call sites should use.
 * It:
 *   1. Resolves which providers to call (from coverage matrix)
 *   2. Dispatches CHAIN or FANOUT based on execution mode
 *   3. Records the sync run in external_sync_runs (per-attempt + summary)
 *   4. Returns aggregated results
 *
 * @param ctx - Work item context
 * @param fetchFnRegistry - Map of provider key → fetch function
 * @param supabase - Supabase client (service role for DB writes)
 * @param supabaseUrl - For edge function invocations
 * @param authHeader - For edge function invocations
 * @param options - Optional overrides
 */
export async function orchestrateSync(
  ctx: SyncRunContext,
  fetchFnRegistry: Map<string, ProviderFetchFn>,
  supabase: any,
  supabaseUrl: string,
  authHeader: string,
  options?: {
    skipEstados?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
    skipRunRecord?: boolean; // For demo/test where we don't want DB writes
    /** Pre-loaded coverage overrides (avoids re-querying) */
    coverageOverrides?: CoverageOverrideRow[];
  },
): Promise<SyncRunResult> {
  const startTime = Date.now();

  // Load coverage overrides (dynamic providers from DB)
  const overrides = options?.coverageOverrides ?? await loadCoverageOverrides(supabase);

  // Register dynamic providers from overrides into the fetch registry
  const dynamicKeys = new Set<string>();
  for (const ov of overrides) {
    const key = ov.provider_key.toUpperCase();
    // Only add if not already in registry (built-in takes precedence unless override_builtin)
    if (!fetchFnRegistry.has(key) || ov.override_builtin) {
      if (ov.provider_type === "EXTERNAL" && ov.connector_id) {
        fetchFnRegistry.set(key, createDynamicProviderAdapter({
          providerKey: key,
          connectorId: ov.connector_id,
          timeoutMs: ov.timeout_ms || undefined,
        }));
        dynamicKeys.add(key);
      }
    }
  }

  if (dynamicKeys.size > 0) {
    console.log(`[syncOrchestrator] Registered ${dynamicKeys.size} dynamic provider(s): ${[...dynamicKeys].join(", ")}`);
  }

  // Create sync run record
  const syncRunId = options?.skipRunRecord
    ? null
    : await createSyncRun(supabase, ctx);

  const allAttempts: ProviderAttemptResult[] = [];
  let totalInsertedActs = 0;
  let totalSkippedActs = 0;
  let totalInsertedPubs = 0;
  let totalSkippedPubs = 0;
  let overallFoundStatus: FoundStatus = "NOT_FOUND";

  try {
    // Phase 1: Actuaciones — use override-aware coverage
    const actCoverage = getProviderCoverageWithOverrides(ctx.workflowType, "ACTUACIONES", overrides);
    if (actCoverage.compatible && actCoverage.providers.length > 0) {
      const actResult = await executeSync(
        "ACTUACIONES",
        actCoverage.executionMode,
        actCoverage.providers,
        fetchFnRegistry,
        {
          radicado: ctx.radicado,
          workItemId: ctx.workItemId,
          supabase,
          supabaseUrl,
          authHeader,
          timeoutMs: options?.timeoutMs,
          signal: options?.signal,
          _syncRunId: syncRunId,
          _organizationId: ctx.organizationId ?? undefined,
        },
      );
      allAttempts.push(...actResult.attempts);
      totalInsertedActs = actResult.totalInserted;
      totalSkippedActs = actResult.totalSkipped;
      if (actResult.foundStatus !== "NOT_FOUND") {
        overallFoundStatus = actResult.foundStatus;
      }
    }

    // Phase 2: Estados (unless skipped) — use override-aware coverage
    if (!options?.skipEstados) {
      const estCoverage = getProviderCoverageWithOverrides(ctx.workflowType, "ESTADOS", overrides);
      if (estCoverage.compatible && estCoverage.providers.length > 0) {
        const estResult = await executeSync(
          "ESTADOS",
          estCoverage.executionMode,
          estCoverage.providers,
          fetchFnRegistry,
          {
            radicado: ctx.radicado,
            workItemId: ctx.workItemId,
            supabase,
            supabaseUrl,
            authHeader,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal,
            _syncRunId: syncRunId,
            _organizationId: ctx.organizationId ?? undefined,
          },
        );
        allAttempts.push(...estResult.attempts);
        totalInsertedPubs = estResult.totalInserted;
        totalSkippedPubs = estResult.totalSkipped;
        if (estResult.foundStatus === "FOUND_COMPLETE" && overallFoundStatus !== "FOUND_COMPLETE") {
          overallFoundStatus = estResult.foundStatus;
        }
      }
    }

    // Determine overall status
    const hasSuccess = allAttempts.some((a) => a.status === "success");
    const hasErrors = allAttempts.some((a) => a.status === "error" || a.status === "timeout");
    let status: SyncRunResult["status"];
    if (hasSuccess && !hasErrors) status = "SUCCESS";
    else if (hasSuccess) status = "PARTIAL";
    else if (allAttempts.every((a) => a.status === "timeout")) status = "TIMEOUT";
    else status = "FAILED";

    const result: SyncRunResult = {
      syncRunId,
      status,
      totalInsertedActs,
      totalSkippedActs,
      totalInsertedPubs,
      totalSkippedPubs,
      providerAttempts: allAttempts,
      errorCode: null,
      errorMessage: null,
      durationMs: Date.now() - startTime,
      foundStatus: overallFoundStatus,
    };

    await finalizeSyncRun(supabase, syncRunId, result);
    return result;
  } catch (err: any) {
    const result: SyncRunResult = {
      syncRunId,
      status: "FAILED",
      totalInsertedActs,
      totalSkippedActs,
      totalInsertedPubs,
      totalSkippedPubs,
      providerAttempts: allAttempts,
      errorCode: "ORCHESTRATOR_ERROR",
      errorMessage: (err.message || String(err)).slice(0, 500),
      durationMs: Date.now() - startTime,
      foundStatus: "NOT_FOUND",
    };

    await finalizeSyncRun(supabase, syncRunId, result);
    return result;
  }
}

// ═══════════════════════════════════════════
// FINGERPRINT HELPERS (canonical, deduplicated)
// ═══════════════════════════════════════════

/**
 * Generate canonical fingerprint for actuaciones deduplication.
 *
 * POLICY DECISION: `source` inclusion depends on execution mode.
 *   - CHAIN mode (CGP, LABORAL, etc.): includes source to prevent cross-provider
 *     collisions (same event from different providers = different fingerprints).
 *   - FANOUT mode (TUTELA): EXCLUDES source so the same event from CPNU and
 *     TUTELAS produces the SAME fingerprint → DB ON CONFLICT deduplicates.
 *
 * Includes indice to prevent same-day actuación collisions.
 *
 * This is the SINGLE source of truth — all edge functions must use this.
 *
 * @param crossProviderDedup - When true, excludes source from fingerprint
 *        (set this for FANOUT/TUTELA workflows)
 */
export function generateActuacionFingerprint(
  workItemId: string,
  date: string,
  text: string,
  indice?: string,
  source?: string,
  crossProviderDedup = false,
): string {
  const sourcePart = source && !crossProviderDedup ? `|${source}` : "";
  const indexPart = indice ? `|${indice}` : "";
  const normalized = `${workItemId}|${date}|${text.toLowerCase().trim().slice(0, 200)}${indexPart}${sourcePart}`;
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `wi_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

/**
 * Generate canonical fingerprint for publicaciones deduplication.
 * Uses asset_id (guaranteed unique per publication) or falls back to key/title.
 */
export function generatePublicacionFingerprint(
  workItemId: string,
  assetId: string | undefined,
  key: string | undefined,
  title: string,
): string {
  const uniqueId = assetId || key || title;
  const data = `${workItemId}|${uniqueId}`;
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `pub_${workItemId.slice(0, 8)}_${Math.abs(hash).toString(16)}`;
}

// ═══════════════════════════════════════════
// PROVIDER REGISTRY HELPER
// ═══════════════════════════════════════════

/**
 * Create a provider fetch function registry from a map of provider key → fetch function.
 * This is the canonical way to register providers for use with orchestrateSync().
 */
export function createFetchRegistry(
  entries: Array<{ key: string; fetchFn: ProviderFetchFn }>,
): Map<string, ProviderFetchFn> {
  const registry = new Map<string, ProviderFetchFn>();
  for (const entry of entries) {
    registry.set(entry.key, entry.fetchFn);
  }
  return registry;
}
