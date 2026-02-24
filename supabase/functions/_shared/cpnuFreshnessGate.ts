/**
 * cpnuFreshnessGate.ts — Snapshot staleness detection and buscar fallback logic.
 *
 * This module implements the deterministic freshness gate for CPNU /snapshot responses.
 * It prevents silent ingestion of stale data by checking heuristics and automatically
 * triggering /buscar scraping when the snapshot is deemed stale.
 *
 * Used by: cpnuAdapter.ts (monitoring mode), sync-by-work-item, resync-actuaciones,
 *          scheduled-daily-sync (cron), and any other CPNU ingestion path.
 *
 * Freshness heuristics (ANY triggers fallback):
 *   1. max(act_date) from snapshot is > STALE_THRESHOLD_DAYS old (COT)
 *   2. max(act_date) from snapshot is older than DB's last known act_date for this radicado
 *   3. (Optional) Record count is suspiciously low vs historical baseline
 */

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

/** Snapshot is stale if max(act_date) is older than this many days (COT timezone) */
const STALE_THRESHOLD_DAYS = 7;

/** Max buscar scrapes per cron cycle (to prevent cost blowouts) */
export const MAX_BUSCAR_PER_CRON_CYCLE = 20;

/** Bounded concurrency for buscar calls within a single cron run */
export const BUSCAR_CONCURRENCY_LIMIT = 3;

// ═══════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════

export interface FreshnessCheckInput {
  /** max(act_date) from the snapshot response, ISO string YYYY-MM-DD */
  snapshotMaxActDate: string | null;
  /** The DB's last known max act_date for this radicado, ISO string YYYY-MM-DD */
  dbMaxActDate: string | null;
  /** Number of actuaciones returned by snapshot */
  snapshotRecordCount: number;
  /** Historical baseline record count (optional, from DB) */
  historicalRecordCount?: number;
  /** Whether force_refresh was explicitly requested */
  forceRefresh?: boolean;
}

export type StaleReason =
  | 'FORCE_REFRESH'
  | 'SNAPSHOT_MAX_DATE_TOO_OLD'
  | 'SNAPSHOT_BEHIND_DB'
  | 'RECORD_COUNT_LOW'
  | 'NO_SNAPSHOT_DATES';

export interface FreshnessCheckResult {
  isStale: boolean;
  reason: StaleReason | null;
  snapshotMaxActDate: string | null;
  dbMaxActDate: string | null;
  thresholdDays: number;
  /** Detailed explanation for logging */
  explanation: string;
}

export interface IngestionMetadata {
  cpnu_source_mode: 'SNAPSHOT' | 'BUSCAR';
  cpnu_snapshot_max_date: string | null;
  cpnu_fetched_at: string;
  cpnu_force_refresh: boolean;
  cpnu_stale_reason: StaleReason | null;
}

// ═══════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════

/**
 * Get current date in Colombia timezone (UTC-5) as YYYY-MM-DD.
 */
function getCOTToday(): string {
  const now = new Date();
  // COT = UTC-5
  const cotOffset = -5 * 60;
  const cotTime = new Date(now.getTime() + cotOffset * 60 * 1000);
  return cotTime.toISOString().slice(0, 10);
}

/**
 * Parse a YYYY-MM-DD date string into epoch ms (midnight UTC).
 */
function parseDate(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getTime();
}

/**
 * Compute the number of days between two YYYY-MM-DD date strings.
 * Returns positive if dateA is before dateB.
 */
function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 86400000;
  return Math.floor((parseDate(dateB) - parseDate(dateA)) / msPerDay);
}

// ═══════════════════════════════════════════
// CORE FRESHNESS CHECK
// ═══════════════════════════════════════════

/**
 * Determine if a CPNU /snapshot response is stale and should trigger /buscar fallback.
 *
 * This is the SINGLE function all CPNU ingestion paths must call after receiving
 * a /snapshot response. It is deterministic and side-effect-free.
 */
export function checkSnapshotFreshness(input: FreshnessCheckInput): FreshnessCheckResult {
  const today = getCOTToday();

  // Explicit force_refresh always wins
  if (input.forceRefresh) {
    return {
      isStale: true,
      reason: 'FORCE_REFRESH',
      snapshotMaxActDate: input.snapshotMaxActDate,
      dbMaxActDate: input.dbMaxActDate,
      thresholdDays: STALE_THRESHOLD_DAYS,
      explanation: 'Force refresh requested — bypassing snapshot.',
    };
  }

  // No dates in snapshot? Can't verify freshness → treat as stale
  if (!input.snapshotMaxActDate) {
    return {
      isStale: true,
      reason: 'NO_SNAPSHOT_DATES',
      snapshotMaxActDate: null,
      dbMaxActDate: input.dbMaxActDate,
      thresholdDays: STALE_THRESHOLD_DAYS,
      explanation: 'Snapshot returned no act_date values — cannot verify freshness.',
    };
  }

  // Heuristic 1: max(act_date) is too old relative to today (COT)
  const daysOld = daysBetween(input.snapshotMaxActDate, today);
  if (daysOld > STALE_THRESHOLD_DAYS) {
    return {
      isStale: true,
      reason: 'SNAPSHOT_MAX_DATE_TOO_OLD',
      snapshotMaxActDate: input.snapshotMaxActDate,
      dbMaxActDate: input.dbMaxActDate,
      thresholdDays: STALE_THRESHOLD_DAYS,
      explanation: `Snapshot max(act_date)=${input.snapshotMaxActDate} is ${daysOld} days old (threshold: ${STALE_THRESHOLD_DAYS}).`,
    };
  }

  // Heuristic 2: snapshot max(act_date) is behind DB's last known date
  if (input.dbMaxActDate && input.snapshotMaxActDate < input.dbMaxActDate) {
    return {
      isStale: true,
      reason: 'SNAPSHOT_BEHIND_DB',
      snapshotMaxActDate: input.snapshotMaxActDate,
      dbMaxActDate: input.dbMaxActDate,
      thresholdDays: STALE_THRESHOLD_DAYS,
      explanation: `Snapshot max(act_date)=${input.snapshotMaxActDate} is behind DB max=${input.dbMaxActDate}.`,
    };
  }

  // Heuristic 3 (optional): suspiciously low record count
  if (
    input.historicalRecordCount &&
    input.historicalRecordCount > 10 &&
    input.snapshotRecordCount < input.historicalRecordCount * 0.5
  ) {
    return {
      isStale: true,
      reason: 'RECORD_COUNT_LOW',
      snapshotMaxActDate: input.snapshotMaxActDate,
      dbMaxActDate: input.dbMaxActDate,
      thresholdDays: STALE_THRESHOLD_DAYS,
      explanation: `Snapshot returned ${input.snapshotRecordCount} records vs historical ${input.historicalRecordCount} (< 50%).`,
    };
  }

  // Fresh!
  return {
    isStale: false,
    reason: null,
    snapshotMaxActDate: input.snapshotMaxActDate,
    dbMaxActDate: input.dbMaxActDate,
    thresholdDays: STALE_THRESHOLD_DAYS,
    explanation: `Snapshot is fresh: max(act_date)=${input.snapshotMaxActDate}, ${daysOld} days old.`,
  };
}

// ═══════════════════════════════════════════
// INGESTION METADATA BUILDER
// ═══════════════════════════════════════════

/**
 * Build ingestion metadata for persisting on the sync run record.
 */
export function buildIngestionMetadata(
  sourceMode: 'SNAPSHOT' | 'BUSCAR',
  snapshotMaxActDate: string | null,
  forceRefresh: boolean,
  staleReason: StaleReason | null,
): IngestionMetadata {
  return {
    cpnu_source_mode: sourceMode,
    cpnu_snapshot_max_date: snapshotMaxActDate,
    cpnu_fetched_at: new Date().toISOString(),
    cpnu_force_refresh: forceRefresh,
    cpnu_stale_reason: staleReason,
  };
}

// ═══════════════════════════════════════════
// DB HELPERS (for use in edge functions)
// ═══════════════════════════════════════════

/**
 * Fetch the DB's max act_date for a given work item.
 * Returns YYYY-MM-DD or null.
 */
export async function getDbMaxActDate(
  supabase: any,
  workItemId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('work_item_acts')
      .select('act_date')
      .eq('work_item_id', workItemId)
      .eq('is_archived', false)
      .order('act_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.act_date?.slice(0, 10) || null;
  } catch {
    return null;
  }
}

/**
 * Get the historical record count for a work item (for heuristic 3).
 */
export async function getHistoricalRecordCount(
  supabase: any,
  workItemId: string,
): Promise<number> {
  try {
    const { count } = await supabase
      .from('work_item_acts')
      .select('id', { count: 'exact', head: true })
      .eq('work_item_id', workItemId)
      .eq('is_archived', false);
    return count || 0;
  } catch {
    return 0;
  }
}

/**
 * Persist ingestion metadata on the sync run record.
 */
export async function persistIngestionMetadata(
  supabase: any,
  syncRunId: string | null,
  metadata: IngestionMetadata,
): Promise<void> {
  if (!syncRunId) return;
  try {
    await supabase
      .from('external_sync_runs')
      .update({
        cpnu_source_mode: metadata.cpnu_source_mode,
        cpnu_snapshot_max_date: metadata.cpnu_snapshot_max_date,
        cpnu_force_refresh: metadata.cpnu_force_refresh,
      })
      .eq('id', syncRunId);
  } catch {
    // Best-effort
  }
}

/**
 * Mark a work item as needing CPNU refresh (for cron cap overflow).
 */
export async function markNeedsCpnuRefresh(
  supabase: any,
  workItemId: string,
  needsRefresh: boolean,
): Promise<void> {
  try {
    const update: Record<string, unknown> = { needs_cpnu_refresh: needsRefresh };
    if (!needsRefresh) {
      update.last_cpnu_buscar_at = new Date().toISOString();
    }
    await supabase
      .from('work_items')
      .update(update)
      .eq('id', workItemId);
  } catch {
    // Best-effort
  }
}

/**
 * Extract max(act_date) from a list of normalized actuaciones.
 * Returns YYYY-MM-DD or null.
 */
export function extractMaxActDate(actuaciones: Array<{ fecha_actuacion?: string }>): string | null {
  let max: string | null = null;
  for (const act of actuaciones) {
    const date = act.fecha_actuacion?.slice(0, 10);
    if (date && (!max || date > max)) {
      max = date;
    }
  }
  return max;
}
