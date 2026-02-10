import { describe, it, expect } from "vitest";

/**
 * Unit tests for sync outcome semantics.
 *
 * These test the pure business logic for how sync results map to
 * work_item_sources state transitions, matching the spec in
 * provider-sync-external-provider and syncPolicy conventions.
 */

// ── Types mirroring work_item_sources state ──

interface WorkItemSourceState {
  scrape_status: "OK" | "SCRAPING_PENDING" | "EMPTY" | "ERROR";
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  consecutive_failures: number;
  consecutive_404_count: number;
}

interface SyncResult {
  ok: boolean;
  result_code: string;
  data?: { actuaciones?: unknown[]; publicaciones?: unknown[] };
  error?: string;
}

// ── Pure function that computes state transition ──

function applySyncResult(
  prev: WorkItemSourceState,
  result: SyncResult
): { next: WorkItemSourceState; enqueueRetry: boolean; updateLastSyncedAt: boolean } {
  const next = { ...prev };
  let enqueueRetry = false;
  let updateLastSyncedAt = false;

  if (result.ok && result.result_code === "OK") {
    // Case A: Success with data
    next.scrape_status = "OK";
    next.last_synced_at = new Date().toISOString();
    next.last_error_code = null;
    next.last_error_message = null;
    next.consecutive_failures = 0;
    // Do NOT reset consecutive_404_count on success (only explicit OK data does)
    next.consecutive_404_count = 0;
    updateLastSyncedAt = true;
  } else if (result.result_code === "PROVIDER_EMPTY_RESULT") {
    // Case B: OK but empty
    next.scrape_status = "EMPTY";
    next.last_error_code = "PROVIDER_EMPTY_RESULT";
    next.last_error_message = "Provider returned no records";
    next.consecutive_failures = prev.consecutive_failures + 1;
    // Do NOT increment consecutive_404_count for empty results
    // Do NOT update last_synced_at
    updateLastSyncedAt = false;
  } else if (
    result.result_code === "SCRAPING_PENDING" ||
    result.result_code === "SCRAPING_TIMEOUT"
  ) {
    // Case C: Transient / pending
    next.scrape_status = "SCRAPING_PENDING";
    next.last_error_code = result.result_code;
    next.last_error_message = result.error || "Scraping initiated";
    // Do NOT update last_synced_at
    // Do NOT increment consecutive_failures for transient
    enqueueRetry = true;
    updateLastSyncedAt = false;
  } else if (
    ["PROVIDER_404", "RECORD_NOT_FOUND", "PROVIDER_NOT_FOUND", "UPSTREAM_ROUTE_MISSING"].includes(
      result.result_code
    )
  ) {
    // Case D: Strict 404
    next.scrape_status = "ERROR";
    next.last_error_code = result.result_code;
    next.last_error_message = result.error || "Not found";
    next.consecutive_failures = prev.consecutive_failures + 1;
    next.consecutive_404_count = prev.consecutive_404_count + 1;
    updateLastSyncedAt = false;
  } else {
    // Generic error
    next.scrape_status = "ERROR";
    next.last_error_code = result.result_code;
    next.last_error_message = result.error || "Unknown error";
    next.consecutive_failures = prev.consecutive_failures + 1;
    updateLastSyncedAt = false;
  }

  return { next, enqueueRetry, updateLastSyncedAt };
}

// ── Helpers ──

function freshState(): WorkItemSourceState {
  return {
    scrape_status: "ERROR",
    last_synced_at: null,
    last_error_code: null,
    last_error_message: null,
    consecutive_failures: 0,
    consecutive_404_count: 0,
  };
}

// ── Tests ──

describe("PROVIDER_EMPTY_RESULT semantics", () => {
  it("sets scrape_status to EMPTY", () => {
    const { next } = applySyncResult(freshState(), {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(next.scrape_status).toBe("EMPTY");
  });

  it("increments consecutive_failures", () => {
    const prev = { ...freshState(), consecutive_failures: 2 };
    const { next } = applySyncResult(prev, {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(next.consecutive_failures).toBe(3);
  });

  it("does NOT increment consecutive_404_count", () => {
    const prev = { ...freshState(), consecutive_404_count: 1 };
    const { next } = applySyncResult(prev, {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(next.consecutive_404_count).toBe(1);
  });

  it("does NOT update last_synced_at", () => {
    const { updateLastSyncedAt } = applySyncResult(freshState(), {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(updateLastSyncedAt).toBe(false);
  });

  it("is NOT transient (no retry enqueued)", () => {
    const { enqueueRetry } = applySyncResult(freshState(), {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(enqueueRetry).toBe(false);
  });

  it("sets last_error_code to PROVIDER_EMPTY_RESULT", () => {
    const { next } = applySyncResult(freshState(), {
      ok: true,
      result_code: "PROVIDER_EMPTY_RESULT",
    });
    expect(next.last_error_code).toBe("PROVIDER_EMPTY_RESULT");
  });
});

describe("SCRAPING_PENDING semantics", () => {
  it("sets scrape_status to SCRAPING_PENDING", () => {
    const { next } = applySyncResult(freshState(), {
      ok: false,
      result_code: "SCRAPING_PENDING",
    });
    expect(next.scrape_status).toBe("SCRAPING_PENDING");
  });

  it("enqueues retry", () => {
    const { enqueueRetry } = applySyncResult(freshState(), {
      ok: false,
      result_code: "SCRAPING_PENDING",
    });
    expect(enqueueRetry).toBe(true);
  });

  it("does NOT update last_synced_at", () => {
    const { updateLastSyncedAt } = applySyncResult(freshState(), {
      ok: false,
      result_code: "SCRAPING_PENDING",
    });
    expect(updateLastSyncedAt).toBe(false);
  });

  it("does NOT increment consecutive_failures", () => {
    const prev = { ...freshState(), consecutive_failures: 3 };
    const { next } = applySyncResult(prev, {
      ok: false,
      result_code: "SCRAPING_PENDING",
    });
    expect(next.consecutive_failures).toBe(3);
  });

  it("SCRAPING_TIMEOUT also enqueues retry", () => {
    const { enqueueRetry, next } = applySyncResult(freshState(), {
      ok: false,
      result_code: "SCRAPING_TIMEOUT",
    });
    expect(enqueueRetry).toBe(true);
    expect(next.scrape_status).toBe("SCRAPING_PENDING");
  });
});

describe("OK (success with data) semantics", () => {
  it("sets scrape_status to OK and updates last_synced_at", () => {
    const { next, updateLastSyncedAt } = applySyncResult(freshState(), {
      ok: true,
      result_code: "OK",
      data: { actuaciones: [{}] },
    });
    expect(next.scrape_status).toBe("OK");
    expect(updateLastSyncedAt).toBe(true);
  });

  it("resets consecutive_failures and consecutive_404_count", () => {
    const prev = { ...freshState(), consecutive_failures: 5, consecutive_404_count: 3 };
    const { next } = applySyncResult(prev, { ok: true, result_code: "OK" });
    expect(next.consecutive_failures).toBe(0);
    expect(next.consecutive_404_count).toBe(0);
  });

  it("clears error fields", () => {
    const prev = { ...freshState(), last_error_code: "SOME_ERR", last_error_message: "oops" };
    const { next } = applySyncResult(prev, { ok: true, result_code: "OK" });
    expect(next.last_error_code).toBeNull();
    expect(next.last_error_message).toBeNull();
  });
});

describe("Strict 404 semantics", () => {
  const codes = ["PROVIDER_404", "RECORD_NOT_FOUND", "PROVIDER_NOT_FOUND", "UPSTREAM_ROUTE_MISSING"];

  codes.forEach((code) => {
    it(`${code} increments both consecutive_failures and consecutive_404_count`, () => {
      const prev = { ...freshState(), consecutive_failures: 1, consecutive_404_count: 1 };
      const { next } = applySyncResult(prev, { ok: false, result_code: code });
      expect(next.consecutive_failures).toBe(2);
      expect(next.consecutive_404_count).toBe(2);
      expect(next.scrape_status).toBe("ERROR");
    });
  });
});
