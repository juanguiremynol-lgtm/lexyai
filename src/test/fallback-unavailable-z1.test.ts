/**
 * Z1 — fallback advances ONLY on an answered absence.
 *
 * A timeout, 5xx, network error or rate limit is UNAVAILABLE: an absence of
 * knowledge, never an absence of judicial activity. Accepting a different
 * provider's answer after the primary failed to answer is how a missed
 * actuación becomes a missed término.
 */
import { describe, it, expect } from "vitest";
import {
  decideFallback,
  isRetryableSameProvider,
} from "@/lib/resolveProviderChain";
import {
  determineFoundStatus,
  shouldTriggerFallback,
  isAnsweredAbsence,
  isTransientProviderFailure,
} from "../../supabase/functions/_shared/providerStrategy.ts";

const TRANSIENT = [
  "PROVIDER_TIMEOUT",
  "NETWORK_ERROR",
  "UPSTREAM_ERROR",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "SCRAPING_STUCK",
];

describe("Z1 — determineFoundStatus", () => {
  it("nobody answered → UNAVAILABLE, never NOT_FOUND", () => {
    expect(determineFoundStatus(false, false, true)).toBe("UNAVAILABLE");
  });

  it("everybody answered with nothing → NOT_FOUND", () => {
    expect(determineFoundStatus(false, false, false)).toBe("NOT_FOUND");
  });

  it("data retrieved → FOUND_COMPLETE", () => {
    expect(determineFoundStatus(true, true, false)).toBe("FOUND_COMPLETE");
  });

  it("metadata only → FOUND_PARTIAL", () => {
    expect(determineFoundStatus(true, false, false)).toBe("FOUND_PARTIAL");
  });
});

describe("Z1 — shouldTriggerFallback", () => {
  it("fires on an answered absence", () => {
    expect(shouldTriggerFallback("NOT_FOUND")).toBe(true);
  });

  it("never fires on UNAVAILABLE", () => {
    expect(shouldTriggerFallback("UNAVAILABLE")).toBe(false);
  });

  it("never fires on a partial or complete find", () => {
    expect(shouldTriggerFallback("FOUND_PARTIAL")).toBe(false);
    expect(shouldTriggerFallback("FOUND_COMPLETE")).toBe(false);
  });
});

describe("Z1 — code classification", () => {
  it.each(TRANSIENT)("%s is silence, not absence", (code) => {
    expect(isTransientProviderFailure(code)).toBe(true);
    expect(isAnsweredAbsence(code)).toBe(false);
  });

  it("PROVIDER_NOT_FOUND is an answered absence", () => {
    expect(isAnsweredAbsence("PROVIDER_NOT_FOUND")).toBe(true);
    expect(isTransientProviderFailure("PROVIDER_NOT_FOUND")).toBe(false);
  });
});

describe("Z1 — decideFallback (frontend implementation, same rule)", () => {
  it.each(TRANSIENT)("%s stops the chain as UNAVAILABLE", (code) => {
    expect(decideFallback(code, false, false)).toBe("STOP_UNAVAILABLE");
    expect(decideFallback(code, false, true)).toBe("STOP_UNAVAILABLE");
  });

  it("an answered absence may advance", () => {
    expect(decideFallback("PROVIDER_NOT_FOUND", false, false)).toBe("CONTINUE");
  });

  it("empty advances only when the policy allows it", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, false)).toBe("STOP_EMPTY");
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, true)).toBe("CONTINUE");
  });

  it("retry semantics survive the fix — same provider, never another", () => {
    for (const code of TRANSIENT) {
      expect(isRetryableSameProvider(code)).toBe(true);
      expect(decideFallback(code, false, false)).not.toBe("CONTINUE");
    }
  });
});
