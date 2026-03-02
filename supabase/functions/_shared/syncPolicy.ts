/**
 * syncPolicy.ts — Single source of truth for sync invariants
 *
 * Imported by: scheduled-daily-sync, fallback-sync-check, process-retry-queue,
 * atenia-ai-autopilot.
 *
 * Every reliability invariant lives here so edge functions stay thin orchestrators.
 */

// ────────────────────────────── Constants ──────────────────────────────

/** Error codes that indicate transient scraping states — NOT demonitorable */
export const TRANSIENT_ERROR_CODES = [
  'SCRAPING_TIMEOUT',
  'SCRAPING_PENDING',
  'SCRAPING_TIMEOUT_RETRY_SCHEDULED',
] as const;

/** Error codes that are true 404 / "record doesn't exist" signals OR terminal dead-letters */
export const DEMONITOR_ELIGIBLE_ERROR_CODES = [
  'PROVIDER_404',
  'RECORD_NOT_FOUND',
  'PROVIDER_NOT_FOUND',
  'UPSTREAM_ROUTE_MISSING',
  'SCRAPING_STUCK',       // Terminal: max retries exhausted, no data ever retrieved
  'OMITIDO',              // CPNU returns "omitido" — case skipped/excluded by provider
] as const;

/**
 * Normalize external provider error codes to canonical ATENIA error codes.
 *
 * This is the ONLY place where provider-specific codes are mapped to ATENIA
 * internal codes. Only the normalized codes should drive counter increments.
 *
 * Rules:
 *  - Only codes in DEMONITOR_ELIGIBLE_ERROR_CODES increment consecutive_404_count.
 *  - Empty arrays / missing fields must NEVER be classified as strict-404.
 *  - Unknown codes fall through as PROVIDER_ERROR (non-404, non-transient).
 */
export function normalizeProviderErrorCode(
  providerCode: string | null | undefined,
  httpStatus?: number,
): string {
  if (!providerCode && httpStatus === 404) return 'PROVIDER_404';
  // No error code + successful HTTP status = OK (e.g., SAMAI Estados returns {error: null, actuaciones: [...]})
  if (!providerCode && httpStatus && httpStatus >= 200 && httpStatus < 300) return 'OK';
  if (!providerCode) return 'PROVIDER_ERROR';

  const upper = providerCode.toUpperCase().replace(/[\s-]+/g, '_');

  // Strict-404 mappings (provider variants → canonical)
  const STRICT_404_MAP: Record<string, string> = {
    '404': 'PROVIDER_404',
    'NOT_FOUND': 'RECORD_NOT_FOUND',
    'RECORD_NOT_FOUND': 'RECORD_NOT_FOUND',
    'PROVIDER_NOT_FOUND': 'PROVIDER_NOT_FOUND',
    'CASE_NOT_FOUND': 'RECORD_NOT_FOUND',
    'EXPEDIENTE_NOT_FOUND': 'RECORD_NOT_FOUND',
    'UPSTREAM_ROUTE_MISSING': 'UPSTREAM_ROUTE_MISSING',
    'PROVIDER_ROUTE_NOT_FOUND': 'UPSTREAM_ROUTE_MISSING',
    'ROUTE_NOT_FOUND': 'UPSTREAM_ROUTE_MISSING',
    'OMITIDO': 'OMITIDO',
  };
  if (STRICT_404_MAP[upper]) return STRICT_404_MAP[upper];

  // Transient mappings (provider variants → canonical)
  const TRANSIENT_MAP: Record<string, string> = {
    'SCRAPING_INITIATED': 'SCRAPING_PENDING',
    'SCRAPING_PENDING': 'SCRAPING_PENDING',
    'SCRAPING_TIMEOUT': 'SCRAPING_TIMEOUT',
    'SCRAPING_TIMEOUT_RETRY_SCHEDULED': 'SCRAPING_TIMEOUT_RETRY_SCHEDULED',
    'SCRAPING_IN_PROGRESS': 'SCRAPING_PENDING',
    'JOB_PENDING': 'SCRAPING_PENDING',
    'JOB_IN_PROGRESS': 'SCRAPING_PENDING',
  };
  if (TRANSIENT_MAP[upper]) return TRANSIENT_MAP[upper];

  // Empty result — never strict-404
  const EMPTY_MAP: Record<string, string> = {
    'EMPTY': 'PROVIDER_EMPTY_RESULT',
    'NO_RECORDS': 'PROVIDER_EMPTY_RESULT',
    'PROVIDER_EMPTY_RESULT': 'PROVIDER_EMPTY_RESULT',
    'ZERO_RESULTS': 'PROVIDER_EMPTY_RESULT',
  };
  if (EMPTY_MAP[upper]) return EMPTY_MAP[upper];

  // Known non-404 errors
  const NON_404_MAP: Record<string, string> = {
    'RATE_LIMITED': 'PROVIDER_RATE_LIMITED',
    'PROVIDER_RATE_LIMITED': 'PROVIDER_RATE_LIMITED',
    'TOO_MANY_REQUESTS': 'PROVIDER_RATE_LIMITED',
    'TIMEOUT': 'PROVIDER_TIMEOUT',
    'PROVIDER_TIMEOUT': 'PROVIDER_TIMEOUT',
    'NETWORK_ERROR': 'NETWORK_ERROR',
    'CONNECTION_REFUSED': 'NETWORK_ERROR',
    'FETCH_ERROR': 'FETCH_ERROR',
    'UNAUTHORIZED': 'PROVIDER_AUTH_ERROR',
    'FORBIDDEN': 'PROVIDER_AUTH_ERROR',
    'AUTH_ERROR': 'PROVIDER_AUTH_ERROR',
  };
  if (NON_404_MAP[upper]) return NON_404_MAP[upper];

  // Unknown — generic provider error, never strict-404
  return 'PROVIDER_ERROR';
}

/**
 * Context-aware reclassification: downgrades a strict-404 code to PROVIDER_EMPTY_RESULT
 * when contextual signals indicate the case exists but returned no events.
 *
 * This prevents false AUTO_DEMONITOR triggers when CPNU returns "no actuaciones found"
 * with a PROVIDER_NOT_FOUND code (provider confirmed the case exists but has no events).
 *
 * Call AFTER normalizeProviderErrorCode and BEFORE isStrict404Code checks.
 */
export function reclassifyWithContext(
  normalizedCode: string,
  message: string | null | undefined,
  dataPayload: Record<string, unknown> | null | undefined,
): { code: string; reclassified: boolean; reason: string } {
  // Only reclassify codes that are currently strict-404
  if (!isStrict404Code(normalizedCode)) {
    return { code: normalizedCode, reclassified: false, reason: 'not_strict_404' };
  }

  const msg = (message || '').toLowerCase();
  const data = dataPayload || {};

  // CPNU pattern: code is PROVIDER_NOT_FOUND but message says "no actuaciones found"
  // or actuacionesCount is explicitly 0 — the case exists but has no events
  const emptySignals = [
    msg.includes('no actuaciones found'),
    msg.includes('no actuaciones'),
    msg.includes('sin actuaciones'),
    msg.includes('0 actuaciones'),
    msg.includes('scraping completed but no'),
    msg.includes('no se encontraron actuaciones'),
    (data.actuacionesCount === 0 || data.actuaciones_count === 0),
    (Array.isArray(data.actuaciones) && data.actuaciones.length === 0 && data.ok !== false),
  ];

  if (emptySignals.some(Boolean)) {
    return {
      code: PROVIDER_EMPTY_RESULT,
      reclassified: true,
      reason: `Downgraded ${normalizedCode} → PROVIDER_EMPTY_RESULT: message/data indicates empty results, not missing case`,
    };
  }

  return { code: normalizedCode, reclassified: false, reason: 'no_empty_signals' };
}

/**
 * Returns true if a normalized code is a strict-404 signal
 * that should increment consecutive_404_count.
 */
export function isStrict404Code(normalizedCode: string): boolean {
  return (DEMONITOR_ELIGIBLE_ERROR_CODES as readonly string[]).includes(normalizedCode);
}

/**
 * Non-transient, non-404 "settled empty" code.
 * Provider returned a valid (non-error) response but with zero actuaciones.
 * Does NOT increment consecutive_404_count, does NOT trigger demonitor,
 * and DOES increment consecutive_failures so admins can track patterns.
 */
export const PROVIDER_EMPTY_RESULT = 'PROVIDER_EMPTY_RESULT' as const;

/**
 * Terminal code for retry rows that exhaust max_attempts.
 * Replaces indefinite SCRAPING_PENDING to prevent permanent spinner.
 */
export const SCRAPING_STUCK = 'SCRAPING_STUCK' as const;

/** Default staleness guard for demonitoring (days) */
export const DEFAULT_STALENESS_GUARD_DAYS = 14;

/** Retry jitter bounds in seconds */
export const RETRY_JITTER_SECONDS: [number, number] = [30, 60];

/** Workflows eligible for external provider sync */
export const SYNC_ENABLED_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'TUTELA', 'PENAL_906'] as const;

/** Terminal stages that never need syncing */
export const TERMINAL_STAGES = [
  'ARCHIVADO',
  'FINALIZADO',
  'EJECUTORIADO',
  'PRECLUIDO_ARCHIVADO',
  'FINALIZADO_ABSUELTO',
  'FINALIZADO_CONDENADO',
] as const;

/** Workflows eligible for publicaciones sync */
export const PUBLICACIONES_WORKFLOWS = ['CGP', 'LABORAL', 'CPACA', 'PENAL_906'] as const;

// ────────────────────────────── Types ──────────────────────────────

export interface SyncResult {
  ok?: boolean;
  scraping_initiated?: boolean;
  scraping_job_id?: string;
  scraping_provider?: string;
  code?: string;
  message?: string;
  inserted_count?: number;
  [key: string]: unknown;
}

export interface RetryRow {
  id?: string;
  work_item_id: string;
  kind: string;
  attempt: number;
  max_attempts: number;
  next_run_at?: string;
}

export interface WorkItemForDemonitor {
  id: string;
  radicado?: string | null;
  consecutive_404_count?: number | null;
  consecutive_failures?: number | null;
  last_error_code?: string | null;
  last_synced_at?: string | null;
  monitoring_enabled?: boolean;
  /** Count of publicaciones for this work item — if > 0, block demonitor */
  publicaciones_count?: number | null;
  /** Count of recent actuaciones from any source — if > 0, block demonitor */
  recent_acts_count?: number | null;
}

export interface DemonitorDecision {
  demonitor: boolean;
  reason?: string;
  blockedBy?: ('PENDING_RETRY' | 'TRANSIENT_ERROR' | 'RECENTLY_HEALTHY' | 'HAS_PUBLICACIONES' | 'HAS_RECENT_ACTS')[];
}

export interface RetryEnqueueDecision {
  enqueue: boolean;
  kind: 'ACT_SCRAPE_RETRY' | 'PUB_RETRY';
  nextRunAt: Date;
  reason: string;
}

export interface AuditEvidence {
  last_error_code: string | null;
  last_synced_at: string | null;
  staleness_guard_days: number;
  retry_row_present: boolean;
  scraping_job_id?: string | null;
  consecutive_404_count?: number | null;
  consecutive_failures?: number | null;
  threshold?: number;
  [key: string]: unknown;
}

// ────────────────────────────── Policy Functions ──────────────────────────────

/**
 * Returns true if the error code indicates a transient scraping state
 * (not a permanent failure, not a 404).
 */
export function isTransientError(code: string | null): boolean {
  if (!code) return false;
  return (TRANSIENT_ERROR_CODES as readonly string[]).includes(code);
}

/**
 * Returns true ONLY when the sync truly succeeded (ok===true).
 * scraping_initiated is explicitly NOT success.
 */
export function shouldCountAsSuccess(syncResult: SyncResult | null | undefined): boolean {
  if (!syncResult) return false;
  return syncResult.ok === true;
}

/**
 * Returns true only when act sync was truly successful (ok===true).
 * Publicaciones sync must NEVER run on scraping_initiated.
 */
export function shouldRunPublicaciones(syncResult: SyncResult | null | undefined): boolean {
  return shouldCountAsSuccess(syncResult);
}

/**
 * Determines whether scraping_initiated was observed (pending job state).
 */
export function isScrapingPending(syncResult: SyncResult | null | undefined): boolean {
  if (!syncResult) return false;
  return (
    syncResult.scraping_initiated === true ||
    syncResult.code === 'SCRAPING_INITIATED' ||
    syncResult.code === 'SCRAPING_TIMEOUT_RETRY_SCHEDULED'
  );
}

/**
 * Determines whether a retry row should be enqueued.
 * Returns enqueue=true when scraping is pending and no active retry exists
 * (or max attempts not exceeded).
 */
export function shouldEnqueueRetry(
  syncResult: SyncResult | null | undefined,
  currentRetryRow: RetryRow | null | undefined,
): RetryEnqueueDecision {
  const noDecision: RetryEnqueueDecision = {
    enqueue: false,
    kind: 'ACT_SCRAPE_RETRY',
    nextRunAt: new Date(),
    reason: '',
  };

  if (!syncResult) return { ...noDecision, reason: 'no_sync_result' };

  const pending = isScrapingPending(syncResult);
  if (!pending) return { ...noDecision, reason: 'not_scraping_pending' };

  // If retry row exists and hasn't exhausted attempts, don't enqueue duplicate
  if (currentRetryRow) {
    if (currentRetryRow.attempt < currentRetryRow.max_attempts) {
      return { ...noDecision, reason: 'retry_row_exists_not_exhausted' };
    }
    return { ...noDecision, reason: 'retry_row_exhausted' };
  }

  // Enqueue with jitter
  const jitterSec = RETRY_JITTER_SECONDS[0] +
    Math.floor(Math.random() * (RETRY_JITTER_SECONDS[1] - RETRY_JITTER_SECONDS[0] + 1));
  const nextRunAt = new Date(Date.now() + jitterSec * 1000);

  return {
    enqueue: true,
    kind: 'ACT_SCRAPE_RETRY',
    nextRunAt,
    reason: `scraping_pending, no active retry row, jitter=${jitterSec}s`,
  };
}

/**
 * Evaluates whether a work item should be auto-demonitored.
 *
 * Safety gates:
 *  1) PENDING_RETRY — item has an active retry row
 *  2) TRANSIENT_ERROR — last_error_code is a transient scraping state
 *  3) RECENTLY_HEALTHY — last_synced_at within staleness window
 *  4) HAS_PUBLICACIONES — work item has publicaciones from any source
 *  5) HAS_RECENT_ACTS — work item has recent actuaciones from any source
 *
 * Gates 4 & 5 prevent demonitoring based exclusively on CPNU/SAMAI 404s
 * when other providers (e.g. Publicaciones Procesales) are actively providing data.
 *
 * Also requires last_error_code to be a 404-type signal (not generic failure).
 */
export function shouldDemonitor(
  item: WorkItemForDemonitor,
  threshold: number,
  hasPendingRetry: boolean,
  stalenessGuardDays: number = DEFAULT_STALENESS_GUARD_DAYS,
): DemonitorDecision {
  const blockedBy: DemonitorDecision['blockedBy'] = [];

  // Threshold check
  const c404 = item.consecutive_404_count ?? 0;
  if (c404 < threshold) {
    return { demonitor: false, reason: `consecutive_404_count (${c404}) < threshold (${threshold})` };
  }

  // Gate 1: pending retry
  if (hasPendingRetry) {
    blockedBy.push('PENDING_RETRY');
  }

  // Gate 2: transient error code (must be a true 404-type signal)
  if (item.last_error_code && isTransientError(item.last_error_code)) {
    blockedBy.push('TRANSIENT_ERROR');
  }
  // Additional: last_error_code must be a 404-type signal
  if (
    item.last_error_code &&
    !(DEMONITOR_ELIGIBLE_ERROR_CODES as readonly string[]).includes(item.last_error_code)
  ) {
    if (!blockedBy.includes('TRANSIENT_ERROR')) {
      blockedBy.push('TRANSIENT_ERROR');
    }
  }

  // Gate 3: staleness guard
  if (item.last_synced_at) {
    const cutoff = new Date(Date.now() - stalenessGuardDays * 24 * 60 * 60 * 1000).toISOString();
    if (item.last_synced_at > cutoff) {
      blockedBy.push('RECENTLY_HEALTHY');
    }
  }

  // Gate 4: Has publicaciones — don't demonitor if Publicaciones Procesales
  // or any other estados source has data for this work item
  if ((item.publicaciones_count ?? 0) > 0) {
    blockedBy.push('HAS_PUBLICACIONES');
  }

  // Gate 5: Has recent actuaciones from any source — don't demonitor if
  // other providers besides the failing one have contributed data
  if ((item.recent_acts_count ?? 0) > 0) {
    blockedBy.push('HAS_RECENT_ACTS');
  }

  if (blockedBy.length > 0) {
    return {
      demonitor: false,
      reason: `Blocked by: ${blockedBy.join(', ')}`,
      blockedBy,
    };
  }

  return {
    demonitor: true,
    reason: `${c404} consecutive 404s, stale >${stalenessGuardDays}d, error_code=${item.last_error_code}`,
  };
}

/**
 * Builds a structured audit evidence payload.
 */
export function buildAuditEvidence(params: {
  item: WorkItemForDemonitor;
  stalenessGuardDays?: number;
  retryRowPresent: boolean;
  scrapingJobId?: string | null;
  threshold?: number;
  extra?: Record<string, unknown>;
}): AuditEvidence {
  return {
    last_error_code: params.item.last_error_code ?? null,
    last_synced_at: params.item.last_synced_at ?? null,
    staleness_guard_days: params.stalenessGuardDays ?? DEFAULT_STALENESS_GUARD_DAYS,
    retry_row_present: params.retryRowPresent,
    scraping_job_id: params.scrapingJobId ?? null,
    consecutive_404_count: params.item.consecutive_404_count ?? null,
    consecutive_failures: params.item.consecutive_failures ?? null,
    threshold: params.threshold,
    ...params.extra,
  };
}

/**
 * Compute retry jitter in milliseconds.
 */
export function retryJitterMs(): number {
  const [minSec, maxSec] = RETRY_JITTER_SECONDS;
  return (minSec + Math.floor(Math.random() * (maxSec - minSec + 1))) * 1000;
}

/**
 * Enriches demonitor candidate work items with publicaciones_count and
 * recent_acts_count so shouldDemonitor() can apply its safety gates.
 *
 * This prevents demonitoring work items that have data from Publicaciones
 * Procesales or other sources even when CPNU/SAMAI return NOT_FOUND.
 */
export async function enrichDemonitorCandidates(
  supabase: any,
  candidates: WorkItemForDemonitor[],
): Promise<WorkItemForDemonitor[]> {
  if (candidates.length === 0) return candidates;

  const ids = candidates.map((c) => c.id);

  // Batch-fetch publicaciones counts
  const { data: pubRows } = await supabase
    .from("work_item_publicaciones")
    .select("work_item_id")
    .in("work_item_id", ids);

  const pubCountMap = new Map<string, number>();
  for (const r of pubRows || []) {
    pubCountMap.set(r.work_item_id, (pubCountMap.get(r.work_item_id) || 0) + 1);
  }

  // Batch-fetch recent acts counts (last 30 days)
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: actRows } = await supabase
    .from("work_item_acts")
    .select("work_item_id")
    .in("work_item_id", ids)
    .gte("created_at", recentCutoff);

  const actCountMap = new Map<string, number>();
  for (const r of actRows || []) {
    actCountMap.set(r.work_item_id, (actCountMap.get(r.work_item_id) || 0) + 1);
  }

  return candidates.map((c) => ({
    ...c,
    publicaciones_count: pubCountMap.get(c.id) ?? 0,
    recent_acts_count: actCountMap.get(c.id) ?? 0,
  }));
}
