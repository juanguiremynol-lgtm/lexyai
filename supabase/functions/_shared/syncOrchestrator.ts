/**
 * syncOrchestrator.ts — Single source of truth for external API sync execution.
 *
 * This module is the ONLY place that decides:
 *   1. Which providers to call for a work item (via providerCoverageMatrix.ts)
 *   2. Call ordering: primary → fallback (via providerStrategy.ts)
 *   3. Per-provider timeouts, retries, circuit breaker awareness
 *   4. Dedupe / idempotency via fingerprint + ON CONFLICT
 *   5. Recording external_sync_runs for observability
 *
 * All call sites (sync-by-work-item, sync-by-radicado, scheduled-daily-sync)
 * MUST use this orchestrator instead of calling provider clients directly.
 *
 * Demo modal (demo-radicado-lookup) is EXCLUDED by design:
 *   - Zero-auth, zero-DB-write, writes to demo_radicado_cache only
 *   - Has its own PROVIDER_REGISTRY with PII redaction
 *
 * Provider matrix (canonical, from providerCoverageMatrix.ts):
 *
 * ┌────────────┬───────────────────────┬───────────────────────┐
 * │ Category   │ ACTUACIONES           │ ESTADOS               │
 * ├────────────┼───────────────────────┼───────────────────────┤
 * │ CGP        │ CPNU (only)           │ Publicaciones (only)  │
 * │ LABORAL    │ CPNU (only)           │ Publicaciones (only)  │
 * │ CPACA      │ SAMAI (only)          │ SAMAI_ESTADOS → Pubs  │
 * │ TUTELA     │ CPNU → SAMAI, Tutelas │ (none)                │
 * │ PENAL_906  │ CPNU → SAMAI          │ Publicaciones (only)  │
 * └────────────┴───────────────────────┴───────────────────────┘
 *
 * Fallback rules:
 *   - CGP/LABORAL: NO fallback for actuaciones (CPNU only).
 *   - CPACA: NO fallback for actuaciones (SAMAI only).
 *   - TUTELA: CPNU primary, fallback to SAMAI then Tutelas API.
 *   - PENAL_906: CPNU primary, fallback to SAMAI.
 *   - Fallback triggers ONLY on NOT_FOUND (no match at all).
 *   - FOUND_PARTIAL does NOT trigger fallback.
 */

import {
  getProviderCoverage,
  type DataKind,
  type ProviderEntry,
} from "./providerCoverageMatrix.ts";
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

/** Default per-provider timeout in ms */
const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

/** Max providers to attempt per data kind before stopping */
const MAX_ATTEMPTS_PER_KIND = 3;

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
      attempts.push({
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
      });
      continue;
    }

    attemptCount++;
    const result = await safeProviderFetch(fetchFn, provider, "PRIMARY", dataKind, params);
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
  },
): Promise<ProviderAttemptResult> {
  const timeoutMs = params.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
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
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════

/**
 * Full sync orchestration for a work item.
 *
 * This is the top-level entry point that all call sites should use.
 * It:
 *   1. Resolves which providers to call (from coverage matrix)
 *   2. Executes actuaciones chain (primary → fallback)
 *   3. Executes estados chain (primary → fallback)
 *   4. Records the sync run in external_sync_runs
 *   5. Returns aggregated results
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
  },
): Promise<SyncRunResult> {
  const startTime = Date.now();

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
    // Phase 1: Actuaciones
    const actCoverage = getProviderCoverage(ctx.workflowType, "ACTUACIONES");
    if (actCoverage.compatible && actCoverage.providers.length > 0) {
      const actResult = await executeSyncChain(
        "ACTUACIONES",
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
        },
      );
      allAttempts.push(...actResult.attempts);
      totalInsertedActs = actResult.totalInserted;
      totalSkippedActs = actResult.totalSkipped;
      if (actResult.foundStatus !== "NOT_FOUND") {
        overallFoundStatus = actResult.foundStatus;
      }
    }

    // Phase 2: Estados (unless skipped)
    if (!options?.skipEstados) {
      const estCoverage = getProviderCoverage(ctx.workflowType, "ESTADOS");
      if (estCoverage.compatible && estCoverage.providers.length > 0) {
        const estResult = await executeSyncChain(
          "ESTADOS",
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
 * Includes source to prevent cross-provider collisions.
 * Includes indice to prevent same-day actuación collisions.
 *
 * This is the SINGLE source of truth — all edge functions must use this.
 */
export function generateActuacionFingerprint(
  workItemId: string,
  date: string,
  text: string,
  indice?: string,
  source?: string,
): string {
  const sourcePart = source ? `|${source}` : "";
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
