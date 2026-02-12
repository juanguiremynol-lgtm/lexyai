import { describe, it, expect } from "vitest";

/**
 * Tests for Fix A: strict-404 misclassification and reclassification logic.
 * Tests for Fix B: convergence semantics for stuck/omitted items.
 *
 * These mirror the pure functions from syncPolicy.ts.
 */

// ── Replicate syncPolicy types/functions for testing ──

const TRANSIENT_ERROR_CODES = [
  'SCRAPING_TIMEOUT',
  'SCRAPING_PENDING',
  'SCRAPING_TIMEOUT_RETRY_SCHEDULED',
] as const;

const DEMONITOR_ELIGIBLE_ERROR_CODES = [
  'PROVIDER_404',
  'RECORD_NOT_FOUND',
  'PROVIDER_NOT_FOUND',
  'UPSTREAM_ROUTE_MISSING',
  'SCRAPING_STUCK',
] as const;

const PROVIDER_EMPTY_RESULT = 'PROVIDER_EMPTY_RESULT' as const;

function normalizeProviderErrorCode(
  providerCode: string | null | undefined,
  httpStatus?: number,
): string {
  if (!providerCode && httpStatus === 404) return 'PROVIDER_404';
  if (!providerCode) return 'PROVIDER_ERROR';

  const upper = providerCode.toUpperCase().replace(/[\s-]+/g, '_');

  const STRICT_404_MAP: Record<string, string> = {
    '404': 'PROVIDER_404',
    'PROVIDER_404': 'PROVIDER_404',
    'RECORD_NOT_FOUND': 'RECORD_NOT_FOUND',
    'PROVIDER_NOT_FOUND': 'PROVIDER_NOT_FOUND',
    'CASE_NOT_FOUND': 'RECORD_NOT_FOUND',
    'EXPEDIENTE_NOT_FOUND': 'RECORD_NOT_FOUND',
    'UPSTREAM_ROUTE_MISSING': 'UPSTREAM_ROUTE_MISSING',
    'PROVIDER_ROUTE_NOT_FOUND': 'UPSTREAM_ROUTE_MISSING',
    'ROUTE_NOT_FOUND': 'UPSTREAM_ROUTE_MISSING',
  };
  if (STRICT_404_MAP[upper]) return STRICT_404_MAP[upper];

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

  const EMPTY_MAP: Record<string, string> = {
    'EMPTY': 'PROVIDER_EMPTY_RESULT',
    'NO_RECORDS': 'PROVIDER_EMPTY_RESULT',
    'PROVIDER_EMPTY_RESULT': 'PROVIDER_EMPTY_RESULT',
    'ZERO_RESULTS': 'PROVIDER_EMPTY_RESULT',
  };
  if (EMPTY_MAP[upper]) return EMPTY_MAP[upper];

  const NON_404_MAP: Record<string, string> = {
    'RATE_LIMITED': 'PROVIDER_RATE_LIMITED',
    'TIMEOUT': 'PROVIDER_TIMEOUT',
    'NETWORK_ERROR': 'NETWORK_ERROR',
  };
  if (NON_404_MAP[upper]) return NON_404_MAP[upper];

  return 'PROVIDER_ERROR';
}

function isStrict404Code(normalizedCode: string): boolean {
  return (DEMONITOR_ELIGIBLE_ERROR_CODES as readonly string[]).includes(normalizedCode);
}

function reclassifyWithContext(
  normalizedCode: string,
  message: string | null | undefined,
  dataPayload: Record<string, unknown> | null | undefined,
): { code: string; reclassified: boolean; reason: string } {
  if (!isStrict404Code(normalizedCode)) {
    return { code: normalizedCode, reclassified: false, reason: 'not_strict_404' };
  }

  const msg = (message || '').toLowerCase();
  const data = dataPayload || {};

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

// ── Demonitor decision (mirroring syncPolicy.shouldDemonitor) ──

interface WorkItemForDemonitor {
  id: string;
  consecutive_404_count?: number | null;
  consecutive_failures?: number | null;
  last_error_code?: string | null;
  last_synced_at?: string | null;
  monitoring_enabled?: boolean;
}

function shouldDemonitor(
  item: WorkItemForDemonitor,
  threshold: number,
  hasPendingRetry: boolean,
): { demonitor: boolean; reason: string } {
  const c404 = item.consecutive_404_count ?? 0;
  if (c404 < threshold) {
    return { demonitor: false, reason: `consecutive_404_count (${c404}) < threshold (${threshold})` };
  }
  if (hasPendingRetry) {
    return { demonitor: false, reason: 'PENDING_RETRY' };
  }
  if (item.last_error_code && !(DEMONITOR_ELIGIBLE_ERROR_CODES as readonly string[]).includes(item.last_error_code)) {
    return { demonitor: false, reason: 'non-404 error code' };
  }
  return { demonitor: true, reason: `${c404} consecutive 404s` };
}

// ── State transition for stuck convergence ──

interface SourceState {
  scrape_status: string;
  last_error_code: string | null;
  updated_at: string;
  consecutive_failures: number;
}

function computeStuckConvergence(
  source: SourceState,
  hasActiveRetry: boolean,
  retryExhausted: boolean,
  stuckTtlMinutes: number,
): { action: 'SKIP' | 'ENQUEUE_RETRY' | 'MARK_TERMINAL'; reason: string } {
  if (source.scrape_status !== 'SCRAPING_PENDING') {
    return { action: 'SKIP', reason: 'not_scraping_pending' };
  }

  const ageMs = Date.now() - new Date(source.updated_at).getTime();
  if (ageMs < stuckTtlMinutes * 60 * 1000) {
    return { action: 'SKIP', reason: 'within_ttl' };
  }

  if (hasActiveRetry) {
    return { action: 'SKIP', reason: 'active_retry_exists' };
  }

  if (retryExhausted || source.consecutive_failures >= 5) {
    return { action: 'MARK_TERMINAL', reason: 'retries_exhausted' };
  }

  return { action: 'ENQUEUE_RETRY', reason: 'stuck_no_retry' };
}

// ═══════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════

describe("Fix A: CPNU empty-result reclassification", () => {
  describe("reclassifyWithContext", () => {
    it("downgrades PROVIDER_NOT_FOUND when message says 'no actuaciones found'", () => {
      const result = reclassifyWithContext(
        "PROVIDER_NOT_FOUND",
        "Scraping completed but no actuaciones found",
        { actuacionesCount: 0 },
      );
      expect(result.reclassified).toBe(true);
      expect(result.code).toBe("PROVIDER_EMPTY_RESULT");
    });

    it("downgrades RECORD_NOT_FOUND when actuacionesCount=0", () => {
      const result = reclassifyWithContext(
        "RECORD_NOT_FOUND",
        "Done",
        { actuacionesCount: 0 },
      );
      expect(result.reclassified).toBe(true);
      expect(result.code).toBe("PROVIDER_EMPTY_RESULT");
    });

    it("downgrades when actuaciones array is empty and ok is not false", () => {
      const result = reclassifyWithContext(
        "PROVIDER_NOT_FOUND",
        "",
        { actuaciones: [], ok: true },
      );
      expect(result.reclassified).toBe(true);
      expect(result.code).toBe("PROVIDER_EMPTY_RESULT");
    });

    it("does NOT downgrade a true strict-404 (no empty signals)", () => {
      const result = reclassifyWithContext(
        "PROVIDER_NOT_FOUND",
        "Case number does not exist in the system",
        { error: "not_found" },
      );
      expect(result.reclassified).toBe(false);
      expect(result.code).toBe("PROVIDER_NOT_FOUND");
    });

    it("does NOT downgrade when ok=false even with empty actuaciones", () => {
      const result = reclassifyWithContext(
        "PROVIDER_404",
        "Not found",
        { actuaciones: [], ok: false },
      );
      expect(result.reclassified).toBe(false);
      expect(result.code).toBe("PROVIDER_404");
    });

    it("does NOT touch non-strict-404 codes", () => {
      const result = reclassifyWithContext(
        "PROVIDER_TIMEOUT",
        "no actuaciones found",
        {},
      );
      expect(result.reclassified).toBe(false);
      expect(result.code).toBe("PROVIDER_TIMEOUT");
    });

    it("downgrades with Spanish message 'sin actuaciones'", () => {
      const result = reclassifyWithContext(
        "PROVIDER_NOT_FOUND",
        "Consulta exitosa, sin actuaciones registradas",
        {},
      );
      expect(result.reclassified).toBe(true);
      expect(result.code).toBe("PROVIDER_EMPTY_RESULT");
    });
  });

  describe("consecutive_404_count must NOT increment for reclassified codes", () => {
    it("PROVIDER_EMPTY_RESULT is NOT a strict-404", () => {
      expect(isStrict404Code("PROVIDER_EMPTY_RESULT")).toBe(false);
    });

    it("reclassified code from CPNU empty response is not strict-404", () => {
      const rawCode = normalizeProviderErrorCode("PROVIDER_NOT_FOUND");
      const { code } = reclassifyWithContext(rawCode, "no actuaciones found", {});
      expect(isStrict404Code(code)).toBe(false);
    });
  });

  describe("AUTO_DEMONITOR must NOT trigger for empty results", () => {
    it("does not demonitor when error code is PROVIDER_EMPTY_RESULT", () => {
      const item: WorkItemForDemonitor = {
        id: "test-1",
        consecutive_404_count: 10, // high count
        consecutive_failures: 10,
        last_error_code: "PROVIDER_EMPTY_RESULT",
        monitoring_enabled: true,
      };
      const decision = shouldDemonitor(item, 5, false);
      expect(decision.demonitor).toBe(false);
    });

    it("DOES demonitor when error code is a true strict-404", () => {
      const item: WorkItemForDemonitor = {
        id: "test-2",
        consecutive_404_count: 6,
        consecutive_failures: 6,
        last_error_code: "PROVIDER_NOT_FOUND",
        monitoring_enabled: true,
      };
      const decision = shouldDemonitor(item, 5, false);
      expect(decision.demonitor).toBe(true);
    });
  });
});

describe("Fix B: stuck item convergence", () => {
  const thirtyOneMinutesAgo = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  it("marks TERMINAL when stuck beyond TTL and retries exhausted", () => {
    const result = computeStuckConvergence(
      { scrape_status: "SCRAPING_PENDING", last_error_code: "SCRAPING_PENDING", updated_at: thirtyOneMinutesAgo, consecutive_failures: 5 },
      false, true, 30,
    );
    expect(result.action).toBe("MARK_TERMINAL");
  });

  it("enqueues retry when stuck beyond TTL but retries NOT exhausted", () => {
    const result = computeStuckConvergence(
      { scrape_status: "SCRAPING_PENDING", last_error_code: "SCRAPING_PENDING", updated_at: thirtyOneMinutesAgo, consecutive_failures: 1 },
      false, false, 30,
    );
    expect(result.action).toBe("ENQUEUE_RETRY");
  });

  it("skips when within TTL", () => {
    const result = computeStuckConvergence(
      { scrape_status: "SCRAPING_PENDING", last_error_code: "SCRAPING_PENDING", updated_at: fiveMinutesAgo, consecutive_failures: 0 },
      false, false, 30,
    );
    expect(result.action).toBe("SKIP");
    expect(result.reason).toBe("within_ttl");
  });

  it("skips when active retry exists", () => {
    const result = computeStuckConvergence(
      { scrape_status: "SCRAPING_PENDING", last_error_code: "SCRAPING_PENDING", updated_at: thirtyOneMinutesAgo, consecutive_failures: 2 },
      true, false, 30,
    );
    expect(result.action).toBe("SKIP");
    expect(result.reason).toBe("active_retry_exists");
  });

  it("skips non-SCRAPING_PENDING statuses", () => {
    const result = computeStuckConvergence(
      { scrape_status: "OK", last_error_code: null, updated_at: thirtyOneMinutesAgo, consecutive_failures: 0 },
      false, false, 30,
    );
    expect(result.action).toBe("SKIP");
  });

  it("marks TERMINAL when consecutive_failures >= 5 even if retry not exhausted flag", () => {
    const result = computeStuckConvergence(
      { scrape_status: "SCRAPING_PENDING", last_error_code: "SCRAPING_PENDING", updated_at: thirtyOneMinutesAgo, consecutive_failures: 5 },
      false, false, 30,
    );
    expect(result.action).toBe("MARK_TERMINAL");
  });
});

describe("normalizeError integration with reclassification", () => {
  it("end-to-end: CPNU returns PROVIDER_NOT_FOUND + 'no actuaciones found' → EMPTY", () => {
    const rawCode = "PROVIDER_NOT_FOUND";
    const normalized = normalizeProviderErrorCode(rawCode);
    expect(normalized).toBe("PROVIDER_NOT_FOUND");
    expect(isStrict404Code(normalized)).toBe(true);

    const { code, reclassified } = reclassifyWithContext(
      normalized,
      "Scraping completed but no actuaciones found",
      { actuacionesCount: 0 },
    );
    expect(reclassified).toBe(true);
    expect(code).toBe("PROVIDER_EMPTY_RESULT");
    expect(isStrict404Code(code)).toBe(false);
  });

  it("end-to-end: true 404 from provider stays as strict-404", () => {
    const rawCode = "PROVIDER_404";
    const normalized = normalizeProviderErrorCode(rawCode);
    const { code, reclassified } = reclassifyWithContext(
      normalized,
      "HTTP 404 - page not found",
      {},
    );
    expect(reclassified).toBe(false);
    expect(code).toBe("PROVIDER_404");
    expect(isStrict404Code(code)).toBe(true);
  });
});
