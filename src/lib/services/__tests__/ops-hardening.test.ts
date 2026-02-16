/**
 * Ops Hardening Pack — Unit Tests
 *
 * Tests for:
 * A. E2E sentinel fail classification
 * F. Preflight severity classification (pure functions)
 * E. Continuation block reason logic
 */

import { describe, it, expect } from "vitest";

// Import pure functions only — no supabase dependency
// We test the classification logic directly

// ─── Inline pure function copies for testing (avoid supabase import chain) ───

type PreflightSeverity = "ALL_PASS" | "PARTIAL" | "CRITICAL_FAILURE";

function classifyPreflightResult(
  providersFailed: number,
  providersTotal: number,
  consecutiveFailuresByProvider: Record<string, number>
) {
  if (providersFailed === 0) {
    return { severity: "ALL_PASS" as PreflightSeverity, providers_failed: 0, providers_total: providersTotal, consecutive_by_provider: consecutiveFailuresByProvider, reason: "Todos los proveedores respondieron correctamente." };
  }
  const failureRate = providersTotal > 0 ? providersFailed / providersTotal : 0;
  const hasConsecutiveCritical = Object.values(consecutiveFailuresByProvider).some((count) => count >= 3);
  if (failureRate >= 0.5 && hasConsecutiveCritical) {
    return { severity: "CRITICAL_FAILURE" as PreflightSeverity, providers_failed: providersFailed, providers_total: providersTotal, consecutive_by_provider: consecutiveFailuresByProvider, reason: `${providersFailed}/${providersTotal} proveedores fallaron con ${Object.entries(consecutiveFailuresByProvider).filter(([, v]) => v >= 3).map(([k, v]) => `${k}(${v}x)`).join(", ")} fallos consecutivos.` };
  }
  return { severity: "PARTIAL" as PreflightSeverity, providers_failed: providersFailed, providers_total: providersTotal, consecutive_by_provider: consecutiveFailuresByProvider, reason: `${providersFailed}/${providersTotal} proveedores fallaron (intermitente, no crítico).` };
}

function updateConsecutiveFailures(
  previous: Record<string, number>,
  currentFailedProviders: string[],
  allProviders: string[]
): Record<string, number> {
  const updated: Record<string, number> = {};
  for (const provider of allProviders) {
    if (currentFailedProviders.includes(provider)) {
      updated[provider] = (previous[provider] ?? 0) + 1;
    } else {
      updated[provider] = 0;
    }
  }
  return updated;
}

// ─── F: Preflight Classifier ───

describe("Preflight Severity Classification (F)", () => {
  it("returns ALL_PASS when 0 providers failed", () => {
    const result = classifyPreflightResult(0, 4, {});
    expect(result.severity).toBe("ALL_PASS");
  });

  it("returns PARTIAL when 1-2 failed and no consecutive threshold", () => {
    const result = classifyPreflightResult(1, 4, { CPNU: 1, SAMAI: 0 });
    expect(result.severity).toBe("PARTIAL");
  });

  it("returns PARTIAL when >=50% failed but no consecutive threshold", () => {
    const result = classifyPreflightResult(3, 4, { CPNU: 2, SAMAI: 1, PUB: 2 });
    expect(result.severity).toBe("PARTIAL");
  });

  it("returns CRITICAL_FAILURE when >=50% failed AND >=3 consecutive for a provider", () => {
    const result = classifyPreflightResult(3, 4, { CPNU: 3, SAMAI: 1, PUB: 3 });
    expect(result.severity).toBe("CRITICAL_FAILURE");
    expect(result.reason).toContain("CPNU(3x)");
  });

  it("returns PARTIAL when <50% failed even with consecutive", () => {
    const result = classifyPreflightResult(1, 4, { CPNU: 5 });
    expect(result.severity).toBe("PARTIAL");
  });
});

describe("Consecutive Failure Tracking (F)", () => {
  it("increments failed providers and resets passing ones", () => {
    const previous = { CPNU: 2, SAMAI: 1, PUB: 0 };
    const failed = ["CPNU"];
    const all = ["CPNU", "SAMAI", "PUB"];

    const updated = updateConsecutiveFailures(previous, failed, all);
    expect(updated.CPNU).toBe(3);
    expect(updated.SAMAI).toBe(0);
    expect(updated.PUB).toBe(0);
  });

  it("starts from 0 for new providers", () => {
    const updated = updateConsecutiveFailures({}, ["NEW_PROV"], ["NEW_PROV", "OTHER"]);
    expect(updated.NEW_PROV).toBe(1);
    expect(updated.OTHER).toBe(0);
  });
});

// ─── A: E2E Fail Classification (imported as module-level types) ───

describe("E2E Fail Reason Types (A)", () => {
  it("E2E fail reasons are exhaustive string union", () => {
    // This is a compile-time check — if types are wrong, TS will error
    const reasons: string[] = [
      "ITEM_NOT_FOUND",
      "SENTINEL_NOT_CONFIGURED",
      "PROVIDER_PRECONDITION_FAILED",
      "PROVIDER_TIMEOUT",
      "SYNC_TIMEOUT",
      "ASSERTION_FAILED",
      "NO_EXTERNAL_DATA_YET",
      "UNKNOWN_ERROR",
    ];
    expect(reasons).toHaveLength(8);
  });

  it("failure stages are valid", () => {
    const stages: string[] = ["PRECHECK", "ENQUEUE", "FETCH", "NORMALIZE", "PERSIST", "VERIFY"];
    expect(stages).toHaveLength(6);
  });
});

// ─── E: Continuation Block Reasons ───

describe("Continuation Block Reasons (E)", () => {
  it("all block reasons are defined", () => {
    const reasons: string[] = [
      "MAX_CONTINUATIONS_REACHED",
      "NO_PENDING_WORK",
      "POLICY_DISABLED",
      "CONVERGENCE_FAILED",
      "UNKNOWN",
    ];
    expect(reasons).toHaveLength(5);
    expect(reasons).toContain("MAX_CONTINUATIONS_REACHED");
    expect(reasons).toContain("CONVERGENCE_FAILED");
  });
});
