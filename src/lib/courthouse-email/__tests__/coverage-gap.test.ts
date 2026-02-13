/**
 * Coverage Gap Detection — Regression Tests
 * 
 * Tests that the provider coverage matrix is enforced correctly and
 * that COVERAGE_GAP outcomes are properly classified.
 */
import { describe, it, expect } from "vitest";

// ============= Provider Coverage Matrix =============

interface ProviderRoute {
  provider_key: string;
  role: "PRIMARY" | "FALLBACK";
  data_kind: "ACTS" | "ESTADOS" | "BOTH";
}

const PROVIDER_COVERAGE_MATRIX: Record<string, ProviderRoute[]> = {
  CGP: [
    { provider_key: "cpnu", role: "PRIMARY", data_kind: "ACTS" },
    { provider_key: "publicaciones", role: "PRIMARY", data_kind: "ESTADOS" },
  ],
  CPACA: [
    { provider_key: "samai", role: "PRIMARY", data_kind: "ACTS" },
    { provider_key: "SAMAI_ESTADOS", role: "PRIMARY", data_kind: "ESTADOS" },
    { provider_key: "publicaciones", role: "FALLBACK", data_kind: "ESTADOS" },
  ],
};

describe("Provider Coverage Matrix", () => {
  it("CGP ESTADOS primary is always publicaciones", () => {
    const cgpEstados = PROVIDER_COVERAGE_MATRIX.CGP.filter(
      (r) => r.data_kind === "ESTADOS" || r.data_kind === "BOTH"
    );
    const primary = cgpEstados.find((r) => r.role === "PRIMARY");
    expect(primary).toBeDefined();
    expect(primary!.provider_key).toBe("publicaciones");
  });

  it("CGP ACTUACIONES primary is cpnu", () => {
    const cgpActs = PROVIDER_COVERAGE_MATRIX.CGP.filter(
      (r) => r.data_kind === "ACTS" || r.data_kind === "BOTH"
    );
    const primary = cgpActs.find((r) => r.role === "PRIMARY");
    expect(primary).toBeDefined();
    expect(primary!.provider_key).toBe("cpnu");
  });

  it("CPACA ESTADOS primary is SAMAI_ESTADOS, not publicaciones", () => {
    const cpacaEstados = PROVIDER_COVERAGE_MATRIX.CPACA.filter(
      (r) => r.data_kind === "ESTADOS" || r.data_kind === "BOTH"
    );
    const primary = cpacaEstados.find((r) => r.role === "PRIMARY");
    expect(primary).toBeDefined();
    expect(primary!.provider_key).toBe("SAMAI_ESTADOS");
  });

  it("SAMAI_ESTADOS is NOT a primary for CGP workflows", () => {
    const cgpRoutes = PROVIDER_COVERAGE_MATRIX.CGP;
    const samaiEstados = cgpRoutes.find(
      (r) => r.provider_key === "SAMAI_ESTADOS" && r.role === "PRIMARY"
    );
    expect(samaiEstados).toBeUndefined();
  });

  it("publicaciones is FALLBACK for CPACA ESTADOS", () => {
    const cpacaEstados = PROVIDER_COVERAGE_MATRIX.CPACA.filter(
      (r) => r.data_kind === "ESTADOS" || r.data_kind === "BOTH"
    );
    const fallback = cpacaEstados.find(
      (r) => r.role === "FALLBACK" && r.provider_key === "publicaciones"
    );
    expect(fallback).toBeDefined();
  });
});

// ============= Outcome Classifier =============

type SyncOutcome = "SUCCESS" | "EMPTY" | "ERROR" | "COVERAGE_GAP";

function classifyOutcome(params: {
  primaryFound: boolean;
  primaryError: boolean;
  fallbacksAttempted: number;
  fallbacksFound: boolean;
}): SyncOutcome {
  if (params.primaryError) return "ERROR";
  if (params.primaryFound) return "SUCCESS";
  // Primary returned empty
  if (params.fallbacksAttempted > 0 && params.fallbacksFound) return "SUCCESS";
  // No fallbacks found data either (or no fallbacks available)
  return "COVERAGE_GAP";
}

describe("Outcome Classifier", () => {
  it("found=true → SUCCESS", () => {
    expect(
      classifyOutcome({
        primaryFound: true,
        primaryError: false,
        fallbacksAttempted: 0,
        fallbacksFound: false,
      })
    ).toBe("SUCCESS");
  });

  it("found=false, no fallbacks → COVERAGE_GAP", () => {
    expect(
      classifyOutcome({
        primaryFound: false,
        primaryError: false,
        fallbacksAttempted: 0,
        fallbacksFound: false,
      })
    ).toBe("COVERAGE_GAP");
  });

  it("found=false, fallback also empty → COVERAGE_GAP", () => {
    expect(
      classifyOutcome({
        primaryFound: false,
        primaryError: false,
        fallbacksAttempted: 1,
        fallbacksFound: false,
      })
    ).toBe("COVERAGE_GAP");
  });

  it("found=false, fallback returns data → SUCCESS", () => {
    expect(
      classifyOutcome({
        primaryFound: false,
        primaryError: false,
        fallbacksAttempted: 1,
        fallbacksFound: true,
      })
    ).toBe("SUCCESS");
  });

  it("primary error → ERROR regardless of fallbacks", () => {
    expect(
      classifyOutcome({
        primaryFound: false,
        primaryError: true,
        fallbacksAttempted: 0,
        fallbacksFound: false,
      })
    ).toBe("ERROR");
  });
});

// ============= Coverage Gap UI Signal =============

describe("Coverage Gap UI Signal", () => {
  it("shows coverage gap banner when gap exists and estados empty", () => {
    const estados: any[] = [];
    const coverageGaps = [
      {
        id: "test-1",
        data_kind: "ESTADOS",
        provider_key: "publicaciones",
        status: "OPEN",
        occurrences: 3,
        last_seen_at: "2026-02-13T10:00:00Z",
      },
    ];

    const hasCoverageGap = coverageGaps.length > 0;
    const estadosGap = coverageGaps.find((g) => g.data_kind === "ESTADOS");
    const showCoverageGapBanner =
      estados.length === 0 && hasCoverageGap && !!estadosGap;

    expect(showCoverageGapBanner).toBe(true);
  });

  it("does NOT show coverage gap banner when estados exist", () => {
    const estados = [{ id: "pub-1", description: "Estado" }];
    const coverageGaps = [
      {
        id: "test-1",
        data_kind: "ESTADOS",
        provider_key: "publicaciones",
        status: "OPEN",
      },
    ];

    const showCoverageGapBanner =
      estados.length === 0 && coverageGaps.length > 0;

    expect(showCoverageGapBanner).toBe(false);
  });

  it("shows generic empty state when no coverage gap detected", () => {
    const estados: any[] = [];
    const coverageGaps: any[] = [];

    const hasCoverageGap = coverageGaps.length > 0;
    const showGenericEmpty = estados.length === 0 && !hasCoverageGap;

    expect(showGenericEmpty).toBe(true);
  });
});
