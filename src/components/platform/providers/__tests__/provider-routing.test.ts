/**
 * Tests for provider routing resolution logic.
 * Covers chain resolution, fallback decisions, and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  resolveProviderChain,
  decideFallback,
  type CategoryRoute,
} from "@/lib/resolveProviderChain";

// Helper to make a route
function makeRoute(
  overrides: Partial<CategoryRoute> & { workflow: string; provider_instance_id: string },
): CategoryRoute {
  return {
    id: crypto.randomUUID(),
    scope: "BOTH",
    route_kind: "PRIMARY",
    priority: 0,
    enabled: true,
    provider_name: "TestProvider",
    ...overrides,
  };
}

describe("resolveProviderChain", () => {
  it("returns built-in defaults when no routes configured", () => {
    const chain = resolveProviderChain("CGP", "ACTS", []);
    expect(chain.length).toBe(1);
    expect(chain[0].provider_name).toBe("cpnu");
    expect(chain[0].source).toBe("BUILTIN");
    expect(chain[0].provider_instance_id).toBeNull();
  });

  it("returns CPACA built-in as SAMAI", () => {
    const chain = resolveProviderChain("CPACA", "ACTS", []);
    expect(chain[0].provider_name).toBe("samai");
    expect(chain[0].source).toBe("BUILTIN");
  });

  it("returns TUTELA built-in chain: cpnu → tutelas-api", () => {
    const chain = resolveProviderChain("TUTELA", "ACTS", []);
    expect(chain.length).toBe(2);
    expect(chain[0].provider_name).toBe("cpnu");
    expect(chain[1].provider_name).toBe("tutelas-api");
  });

  it("external PRIMARY is attempted before built-in", () => {
    const routes: CategoryRoute[] = [
      makeRoute({
        workflow: "CGP",
        provider_instance_id: "ext-1",
        route_kind: "PRIMARY",
        priority: 0,
        provider_name: "ExternalCGP",
      }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    expect(chain.length).toBe(2); // external + cpnu
    expect(chain[0].source).toBe("EXTERNAL_PRIMARY");
    expect(chain[0].provider_name).toBe("ExternalCGP");
    expect(chain[1].source).toBe("BUILTIN");
    expect(chain[1].provider_name).toBe("cpnu");
  });

  it("external FALLBACK comes after built-in", () => {
    const routes: CategoryRoute[] = [
      makeRoute({
        workflow: "CGP",
        provider_instance_id: "fb-1",
        route_kind: "FALLBACK",
        priority: 0,
        provider_name: "FallbackProvider",
      }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    expect(chain.length).toBe(2); // cpnu + fallback
    expect(chain[0].source).toBe("BUILTIN");
    expect(chain[1].source).toBe("EXTERNAL_FALLBACK");
    expect(chain[1].provider_name).toBe("FallbackProvider");
  });

  it("respects priority order within PRIMARY", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "CGP", provider_instance_id: "p2", route_kind: "PRIMARY", priority: 1, provider_name: "Second" }),
      makeRoute({ workflow: "CGP", provider_instance_id: "p1", route_kind: "PRIMARY", priority: 0, provider_name: "First" }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    expect(chain[0].provider_name).toBe("First");
    expect(chain[1].provider_name).toBe("Second");
  });

  it("disabled routes are excluded", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "CGP", provider_instance_id: "ext-1", enabled: false, provider_name: "Disabled" }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    expect(chain.length).toBe(1); // only cpnu
    expect(chain[0].source).toBe("BUILTIN");
  });

  it("ACTS scope excludes PUBS-only routes", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "CGP", provider_instance_id: "pubs-only", scope: "PUBS", provider_name: "PubsOnly" }),
    ];
    const chain = resolveProviderChain("CGP", "ACTS", routes);
    // Should not include the PUBS-only route
    expect(chain.every((c) => c.provider_name !== "PubsOnly")).toBe(true);
  });

  it("BOTH scope matches both ACTS and PUBS queries", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "CGP", provider_instance_id: "both-1", scope: "BOTH", provider_name: "BothScope" }),
    ];
    const actsChain = resolveProviderChain("CGP", "ACTS", routes);
    const pubsChain = resolveProviderChain("CGP", "PUBS", routes);
    expect(actsChain.some((c) => c.provider_name === "BothScope")).toBe(true);
    expect(pubsChain.some((c) => c.provider_name === "BothScope")).toBe(true);
  });

  it("attempt_index is sequential across all candidates", () => {
    const routes: CategoryRoute[] = [
      makeRoute({ workflow: "PENAL_906", provider_instance_id: "p1", route_kind: "PRIMARY", priority: 0, provider_name: "ExtPrimary" }),
      makeRoute({ workflow: "PENAL_906", provider_instance_id: "f1", route_kind: "FALLBACK", priority: 0, provider_name: "ExtFallback" }),
    ];
    const chain = resolveProviderChain("PENAL_906", "ACTS", routes);
    // ExtPrimary(0) → cpnu(1) → samai(2) → ExtFallback(3)
    expect(chain.map((c) => c.attempt_index)).toEqual([0, 1, 2, 3]);
  });

  it("unknown workflow defaults to cpnu", () => {
    const chain = resolveProviderChain("UNKNOWN_WORKFLOW", "ACTS", []);
    expect(chain.length).toBe(1);
    expect(chain[0].provider_name).toBe("cpnu");
  });
});

describe("decideFallback", () => {
  it("OK → STOP_OK", () => {
    expect(decideFallback("OK", true, false)).toBe("STOP_OK");
  });

  it("SCRAPING_PENDING → STOP_PENDING (never fallback)", () => {
    expect(decideFallback("SCRAPING_PENDING", false, false)).toBe("STOP_PENDING");
    expect(decideFallback("SCRAPING_PENDING", false, true)).toBe("STOP_PENDING");
  });

  it("PROVIDER_EMPTY_RESULT + allow_fallback=false → STOP_EMPTY", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, false)).toBe("STOP_EMPTY");
  });

  it("PROVIDER_EMPTY_RESULT + allow_fallback=true → CONTINUE", () => {
    expect(decideFallback("PROVIDER_EMPTY_RESULT", false, true)).toBe("CONTINUE");
  });

  it("SCRAPING_STUCK → CONTINUE", () => {
    expect(decideFallback("SCRAPING_STUCK", false, false)).toBe("CONTINUE");
  });

  it("PROVIDER_RATE_LIMITED → CONTINUE", () => {
    expect(decideFallback("PROVIDER_RATE_LIMITED", false, false)).toBe("CONTINUE");
  });

  it("PROVIDER_TIMEOUT → CONTINUE", () => {
    expect(decideFallback("PROVIDER_TIMEOUT", false, false)).toBe("CONTINUE");
  });

  it("NETWORK_ERROR → CONTINUE", () => {
    expect(decideFallback("NETWORK_ERROR", false, false)).toBe("CONTINUE");
  });

  it("unknown non-retryable code → STOP_ERROR", () => {
    expect(decideFallback("AUTH_FAILED", false, false)).toBe("STOP_ERROR");
  });
});
