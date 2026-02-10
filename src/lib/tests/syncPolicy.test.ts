/**
 * syncPolicy unit tests
 *
 * Covers all invariant gates and semantics from the shared policy engine.
 * Run with: npx vitest run src/lib/tests/syncPolicy.test.ts
 */

import { describe, it, expect } from "vitest";

// ── Inline the pure functions so tests run without Deno imports ──
// These mirror the exact logic from supabase/functions/_shared/syncPolicy.ts

const TRANSIENT_ERROR_CODES = [
  "SCRAPING_TIMEOUT",
  "SCRAPING_PENDING",
  "SCRAPING_TIMEOUT_RETRY_SCHEDULED",
];

const DEMONITOR_ELIGIBLE_ERROR_CODES = [
  "PROVIDER_404",
  "RECORD_NOT_FOUND",
  "PROVIDER_NOT_FOUND",
  "UPSTREAM_ROUTE_MISSING",
];

const DEFAULT_STALENESS_GUARD_DAYS = 14;

function isTransientError(code: string | null): boolean {
  if (!code) return false;
  return TRANSIENT_ERROR_CODES.includes(code);
}

interface SyncResult {
  ok?: boolean;
  scraping_initiated?: boolean;
  code?: string;
  [key: string]: unknown;
}

function shouldCountAsSuccess(syncResult: SyncResult | null | undefined): boolean {
  if (!syncResult) return false;
  return syncResult.ok === true;
}

function shouldRunPublicaciones(syncResult: SyncResult | null | undefined): boolean {
  return shouldCountAsSuccess(syncResult);
}

function isScrapingPending(syncResult: SyncResult | null | undefined): boolean {
  if (!syncResult) return false;
  return (
    syncResult.scraping_initiated === true ||
    syncResult.code === "SCRAPING_INITIATED" ||
    syncResult.code === "SCRAPING_TIMEOUT_RETRY_SCHEDULED"
  );
}

interface RetryRow {
  work_item_id: string;
  kind: string;
  attempt: number;
  max_attempts: number;
}

function shouldEnqueueRetry(
  syncResult: SyncResult | null | undefined,
  currentRetryRow: RetryRow | null | undefined,
) {
  const noDecision = { enqueue: false, kind: "ACT_SCRAPE_RETRY" as const, reason: "" };
  if (!syncResult) return { ...noDecision, reason: "no_sync_result" };
  if (!isScrapingPending(syncResult)) return { ...noDecision, reason: "not_scraping_pending" };
  if (currentRetryRow) {
    if (currentRetryRow.attempt < currentRetryRow.max_attempts) {
      return { ...noDecision, reason: "retry_row_exists_not_exhausted" };
    }
    return { ...noDecision, reason: "retry_row_exhausted" };
  }
  return { enqueue: true, kind: "ACT_SCRAPE_RETRY" as const, reason: "scraping_pending" };
}

interface WorkItem {
  id: string;
  radicado?: string | null;
  consecutive_404_count?: number | null;
  last_error_code?: string | null;
  last_synced_at?: string | null;
}

function shouldDemonitor(
  item: WorkItem,
  threshold: number,
  hasPendingRetry: boolean,
  stalenessGuardDays = DEFAULT_STALENESS_GUARD_DAYS,
) {
  type BlockReason = "PENDING_RETRY" | "TRANSIENT_ERROR" | "RECENTLY_HEALTHY";
  const blockedBy: BlockReason[] = [];
  const c404 = item.consecutive_404_count ?? 0;
  if (c404 < threshold) return { demonitor: false, reason: "below_threshold" };

  if (hasPendingRetry) blockedBy.push("PENDING_RETRY");
  if (item.last_error_code && isTransientError(item.last_error_code)) blockedBy.push("TRANSIENT_ERROR");
  if (item.last_error_code && !DEMONITOR_ELIGIBLE_ERROR_CODES.includes(item.last_error_code)) {
    if (!blockedBy.includes("TRANSIENT_ERROR")) blockedBy.push("TRANSIENT_ERROR");
  }
  if (item.last_synced_at) {
    const cutoff = new Date(Date.now() - stalenessGuardDays * 24 * 60 * 60 * 1000).toISOString();
    if (item.last_synced_at > cutoff) blockedBy.push("RECENTLY_HEALTHY");
  }

  if (blockedBy.length > 0) return { demonitor: false, blockedBy };
  return { demonitor: true };
}

// ════════════════════════ Tests ════════════════════════

describe("syncPolicy — shouldCountAsSuccess", () => {
  it("scraping_initiated must NOT count as success", () => {
    expect(shouldCountAsSuccess({ ok: false, scraping_initiated: true })).toBe(false);
    expect(shouldCountAsSuccess({ scraping_initiated: true })).toBe(false);
  });

  it("only ok===true is success", () => {
    expect(shouldCountAsSuccess({ ok: true })).toBe(true);
    expect(shouldCountAsSuccess({ ok: false })).toBe(false);
    expect(shouldCountAsSuccess(null)).toBe(false);
    expect(shouldCountAsSuccess(undefined)).toBe(false);
  });
});

describe("syncPolicy — shouldRunPublicaciones", () => {
  it("gated on ok===true only", () => {
    expect(shouldRunPublicaciones({ ok: true })).toBe(true);
    expect(shouldRunPublicaciones({ ok: false, scraping_initiated: true })).toBe(false);
    expect(shouldRunPublicaciones({ scraping_initiated: true })).toBe(false);
    expect(shouldRunPublicaciones(null)).toBe(false);
  });
});

describe("syncPolicy — isScrapingPending", () => {
  it("detects scraping_initiated", () => {
    expect(isScrapingPending({ scraping_initiated: true })).toBe(true);
    expect(isScrapingPending({ code: "SCRAPING_INITIATED" })).toBe(true);
    expect(isScrapingPending({ code: "SCRAPING_TIMEOUT_RETRY_SCHEDULED" })).toBe(true);
  });

  it("false for success or failure", () => {
    expect(isScrapingPending({ ok: true })).toBe(false);
    expect(isScrapingPending({ ok: false })).toBe(false);
    expect(isScrapingPending(null)).toBe(false);
  });
});

describe("syncPolicy — shouldEnqueueRetry", () => {
  it("enqueues when scraping pending and no retry row", () => {
    const result = shouldEnqueueRetry({ scraping_initiated: true }, null);
    expect(result.enqueue).toBe(true);
    expect(result.kind).toBe("ACT_SCRAPE_RETRY");
  });

  it("does NOT enqueue when retry row exists and not exhausted", () => {
    const retry: RetryRow = { work_item_id: "x", kind: "ACT_SCRAPE_RETRY", attempt: 1, max_attempts: 3 };
    const result = shouldEnqueueRetry({ scraping_initiated: true }, retry);
    expect(result.enqueue).toBe(false);
  });

  it("does NOT enqueue when not scraping pending", () => {
    expect(shouldEnqueueRetry({ ok: true }, null).enqueue).toBe(false);
    expect(shouldEnqueueRetry({ ok: false }, null).enqueue).toBe(false);
  });
});

describe("syncPolicy — shouldDemonitor", () => {
  const staleItem: WorkItem = {
    id: "1",
    consecutive_404_count: 6,
    last_error_code: "PROVIDER_404",
    last_synced_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
  };

  it("allows demonitor for chronic 404, stale, no retry", () => {
    expect(shouldDemonitor(staleItem, 5, false).demonitor).toBe(true);
  });

  it("blocked if pending retry present", () => {
    const result = shouldDemonitor(staleItem, 5, true);
    expect(result.demonitor).toBe(false);
    expect(result.blockedBy).toContain("PENDING_RETRY");
  });

  it("blocked if transient error code", () => {
    const item = { ...staleItem, last_error_code: "SCRAPING_TIMEOUT" };
    const result = shouldDemonitor(item, 5, false);
    expect(result.demonitor).toBe(false);
    expect(result.blockedBy).toContain("TRANSIENT_ERROR");
  });

  it("blocked if last_synced_at within 14 days", () => {
    const recentItem = {
      ...staleItem,
      last_synced_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    };
    const result = shouldDemonitor(recentItem, 5, false);
    expect(result.demonitor).toBe(false);
    expect(result.blockedBy).toContain("RECENTLY_HEALTHY");
  });

  it("blocked if error code is not 404-type", () => {
    const item = { ...staleItem, last_error_code: "PROVIDER_RATE_LIMITED" };
    const result = shouldDemonitor(item, 5, false);
    expect(result.demonitor).toBe(false);
  });

  it("below threshold is not demonitored", () => {
    const item = { ...staleItem, consecutive_404_count: 3 };
    expect(shouldDemonitor(item, 5, false).demonitor).toBe(false);
  });
});

describe("syncPolicy — isTransientError", () => {
  it("identifies transient codes", () => {
    expect(isTransientError("SCRAPING_TIMEOUT")).toBe(true);
    expect(isTransientError("SCRAPING_PENDING")).toBe(true);
    expect(isTransientError("SCRAPING_TIMEOUT_RETRY_SCHEDULED")).toBe(true);
  });

  it("rejects non-transient codes", () => {
    expect(isTransientError("PROVIDER_404")).toBe(false);
    expect(isTransientError("NETWORK_ERROR")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
