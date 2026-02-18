/**
 * providerAdapters.ts — Thin wrappers that bridge existing provider fetch functions
 * to the orchestrator's ProviderFetchFn interface.
 *
 * DESIGN DECISION (Phase 2.5):
 *   These adapters do NOT perform ingestion (DB writes). They only fetch raw data
 *   from external APIs and return normalized results. Ingestion remains in the
 *   calling edge function's post-processing pipeline, which handles:
 *     - Semantic deduplication
 *     - Stage inference
 *     - Alert generation
 *     - Metadata enrichment
 *     - Courthouse resolution
 *
 *   The orchestrator uses these adapters for:
 *     - Provider selection order (CHAIN vs FANOUT)
 *     - Fallback decisions
 *     - Per-attempt recording (external_sync_run_attempts)
 *     - Timeout/concurrency enforcement
 *
 * Each adapter calls the EXISTING inline fetch function (fetchFromCpnu, fetchFromSamai,
 * fetchFromTutelasApi) without modifying its logic, then translates the FetchResult
 * into the orchestrator's expected return shape.
 */

import type { ProviderFetchFn } from "./syncOrchestrator.ts";

/**
 * FetchResult shape returned by the existing inline provider functions.
 * This mirrors the interface in sync-by-work-item/index.ts.
 */
export interface LegacyFetchResult {
  ok: boolean;
  actuaciones: Array<Record<string, unknown>>;
  expedienteUrl?: string;
  caseMetadata?: Record<string, unknown>;
  sujetos?: Array<Record<string, unknown>>;
  error?: string;
  provider: string;
  isEmpty?: boolean;
  latencyMs?: number;
  httpStatus?: number;
  scrapingInitiated?: boolean;
  scrapingJobId?: string;
  scrapingPollUrl?: string;
  scrapingMessage?: string;
}

/**
 * Type for the existing inline fetch functions.
 * These are passed in from the edge function — NOT imported — to avoid
 * circular dependencies and to keep provider logic in place.
 */
export type LegacyFetchFn = (...args: any[]) => Promise<LegacyFetchResult>;

/**
 * Creates a ProviderFetchFn adapter from an existing inline fetch function.
 *
 * The adapter:
 *   1. Calls the legacy function with the radicado (or tutela_code)
 *   2. Translates the FetchResult into orchestrator's return shape
 *   3. Preserves the raw FetchResult in metadata for post-processing
 *
 * IMPORTANT: The adapter does NOT perform DB writes. The orchestrator records
 * attempt metadata; the calling code performs ingestion from the raw results.
 *
 * @param legacyFn - The existing fetch function (e.g., fetchFromCpnu)
 * @param options - Configuration for identifier selection and scraping behavior
 */
export function createLegacyAdapter(
  legacyFn: LegacyFetchFn,
  options?: {
    /** Use tutela_code from workItem instead of radicado */
    useTutelaCode?: boolean;
    /** Identifier type for TUTELAS API */
    identifierType?: "tutela_code" | "radicado";
    /** Extra args to pass to the legacy function */
    extraArgs?: unknown[];
  },
): ProviderFetchFn {
  return async (params) => {
    const startTime = Date.now();

    try {
      // Determine which identifier to use
      const identifier = params.radicado;

      // Call the legacy function
      const args = options?.identifierType
        ? [identifier, options.identifierType, ...(options.extraArgs || [])]
        : [identifier, ...(options.extraArgs || [])];

      const result: LegacyFetchResult = await legacyFn(...args);

      const latencyMs = result.latencyMs || (Date.now() - startTime);

      return {
        ok: result.ok && !result.isEmpty && result.actuaciones.length > 0,
        found: !result.isEmpty && (result.ok || result.actuaciones.length > 0),
        isEmpty: result.isEmpty || (result.ok && result.actuaciones.length === 0),
        insertedCount: result.actuaciones.length, // Raw count — actual inserts happen in post-processing
        skippedCount: 0,
        httpStatus: result.httpStatus || null,
        errorCode: result.ok ? null : classifyLegacyError(result),
        errorMessage: result.error || null,
        latencyMs,
        metadata: {
          // Preserve the full FetchResult for post-processing
          _legacyResult: result,
          provider: result.provider,
          scrapingInitiated: result.scrapingInitiated || false,
          scrapingJobId: result.scrapingJobId || null,
          scrapingPollUrl: result.scrapingPollUrl || null,
          actuacionesCount: result.actuaciones.length,
          hasCaseMetadata: !!result.caseMetadata,
          hasSujetos: !!(result.sujetos && result.sujetos.length > 0),
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        found: false,
        isEmpty: true,
        insertedCount: 0,
        skippedCount: 0,
        httpStatus: null,
        errorCode: "ADAPTER_ERROR",
        errorMessage: (err.message || String(err)).slice(0, 500),
        latencyMs: Date.now() - startTime,
      };
    }
  };
}

/**
 * Classify a legacy FetchResult error into a standardized error code.
 */
function classifyLegacyError(result: LegacyFetchResult): string {
  if (result.scrapingInitiated) return "SCRAPING_INITIATED";
  if (result.isEmpty) return "PROVIDER_EMPTY_RESULT";

  const err = (result.error || "").toLowerCase();
  const status = result.httpStatus;

  if (status === 401 || status === 403) return "PROVIDER_AUTH_FAILED";
  if (status === 404) return "PROVIDER_404";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  if (status && status >= 500) return "PROVIDER_SERVER_ERROR";
  if (err.includes("timeout") || err.includes("aborted")) return "PROVIDER_TIMEOUT";
  if (err.includes("network") || err.includes("fetch failed")) return "NETWORK_ERROR";
  if (err.includes("record_not_found") || err.includes("not found")) return "PROVIDER_404";
  if (err.includes("scraping")) return "SCRAPING_TIMEOUT";
  if (err.includes("route") || err.includes("html")) return "UPSTREAM_ROUTE_MISSING";

  return "PROVIDER_ERROR";
}

/**
 * Extract the raw LegacyFetchResult from an orchestrator attempt's metadata.
 * Used by the post-processing pipeline to access provider-specific data.
 */
export function extractLegacyResult(
  metadata?: Record<string, unknown>,
): LegacyFetchResult | null {
  if (!metadata) return null;
  return (metadata._legacyResult as LegacyFetchResult) || null;
}

/**
 * Aggregate LegacyFetchResults from multiple orchestrator attempts.
 * Used for FANOUT mode where multiple providers return data that needs merging.
 *
 * Returns results ordered by provider priority for metadata merge.
 */
export function aggregateLegacyResults(
  attempts: Array<{ metadata?: Record<string, unknown>; status: string; provider: string }>,
): LegacyFetchResult[] {
  return attempts
    .filter((a) => a.status === "success" || a.status === "empty")
    .map((a) => extractLegacyResult(a.metadata))
    .filter((r): r is LegacyFetchResult => r !== null && r.actuaciones.length > 0);
}
