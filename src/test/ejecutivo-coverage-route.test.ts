import { describe, it, expect } from "vitest";
import {
  getProviderCoverage,
  isProviderCompatible,
} from "../../supabase/functions/_shared/providerCoverageMatrix.ts";

// EJECUTIVO was absent from the coverage matrix, so the orchestrator made
// zero provider attempts and reported a spurious TIMEOUT.
describe("EJECUTIVO provider coverage", () => {
  it("routes actuaciones to CPNU", () => {
    const r = getProviderCoverage("EJECUTIVO", "ACTUACIONES");
    expect(r.compatible).toBe(true);
    expect(r.providers.map((p) => p.key.toUpperCase())).toContain("CPNU");
  });

  it("routes estados to publicaciones", () => {
    const r = getProviderCoverage("EJECUTIVO", "ESTADOS");
    expect(r.compatible).toBe(true);
    expect(r.providers.map((p) => p.key.toUpperCase())).toContain("PUBLICACIONES");
  });

  it("accepts CPNU and publicaciones as compatible connectors", () => {
    expect(isProviderCompatible("cpnu", "EJECUTIVO", "ACTUACIONES").compatible).toBe(true);
    expect(isProviderCompatible("publicaciones", "EJECUTIVO", "ESTADOS").compatible).toBe(true);
  });

  it("never crosses into the CPACA jurisdiction", () => {
    expect(isProviderCompatible("samai", "EJECUTIVO", "ACTUACIONES").compatible).toBe(false);
  });
});
